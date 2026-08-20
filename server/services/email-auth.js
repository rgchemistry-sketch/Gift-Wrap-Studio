import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import { connectDatabase } from "../config/database.js";
import { emailAuthStatus, env } from "../config/env.js";
import {
  configurationError,
  databaseUnavailable,
  rateLimited,
  unauthorized,
} from "../lib/errors.js";
import { memoryStore } from "../lib/memory-store.js";
import { EmailAuthChallenge } from "../models/EmailAuthChallenge.js";
import { authenticateEmailIdentity } from "./identity-auth.js";
import { emailVerificationProvider } from "./email-verification-provider.js";

const hashChallenge = (value) => createHash("sha256").update(value).digest("hex");
const plain = (record) => (typeof record?.toJSON === "function" ? record.toJSON() : record);

const challengeMode = async () => {
  const mode = await connectDatabase();
  if (mode === "mongodb") return mode;
  if (env.isProduction) throw databaseUnavailable();
  return "memory";
};

const signingSecret = () => {
  const secret = env.emailOtpSecret;
  if (!secret) throw configurationError(["EMAIL_OTP_SECRET"]);
  if (env.isProduction && secret.length < 32) {
    throw configurationError(["EMAIL_OTP_SECRET (at least 32 characters)"]);
  }
  return secret;
};

const hashCode = (challengeHash, code) =>
  createHmac("sha256", signingSecret()).update(`${challengeHash}:${code}`).digest("hex");

const codesMatch = (expected, actual) => {
  const expectedBytes = Buffer.from(expected, "hex");
  const actualBytes = Buffer.from(actual, "hex");
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
};

const maskEmail = (email) => {
  const [local, domain] = email.split("@");
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"•".repeat(Math.max(2, Math.min(6, local.length - visible.length)))}@${domain}`;
};

const recentChallengeRetryAfterSeconds = async (email) => {
  const mode = await challengeMode();
  const now = new Date();
  const since = new Date(now.getTime() - env.emailOtpResendSeconds * 1_000);
  let recent;
  if (mode === "mongodb") {
    recent = await EmailAuthChallenge.findOne({
      email,
      consumedAt: { $exists: false },
      expiresAt: { $gt: now },
      createdAt: { $gte: since },
    })
      .sort({ createdAt: -1 })
      .lean();
  } else {
    [recent] = memoryStore
      .find(
        "emailAuthChallenges",
        (item) => item.email === email
          && !item.consumedAt
          && item.expiresAt > now
          && item.createdAt >= since,
      )
      .sort((left, right) => right.createdAt - left.createdAt);
  }
  if (!recent) return 0;
  const availableAt = new Date(recent.createdAt).getTime() + env.emailOtpResendSeconds * 1_000;
  return Math.max(1, Math.ceil((availableAt - now.getTime()) / 1_000));
};

const saveChallenge = async (record) => {
  const mode = await challengeMode();
  if (mode === "mongodb") return plain(await EmailAuthChallenge.create(record));
  return memoryStore.create("emailAuthChallenges", record, record.challengeHash);
};

const removeChallenge = async (challengeHash) => {
  const mode = await challengeMode();
  if (mode === "mongodb") {
    await EmailAuthChallenge.deleteOne({ challengeHash });
    return;
  }
  memoryStore.remove("emailAuthChallenges", challengeHash);
};

const takeAttempt = async (challengeHash) => {
  const mode = await challengeMode();
  const now = new Date();
  if (mode === "mongodb") {
    return plain(
      await EmailAuthChallenge.findOneAndUpdate(
        {
          challengeHash,
          consumedAt: { $exists: false },
          expiresAt: { $gt: now },
          attempts: { $lt: env.emailOtpMaxAttempts },
        },
        { $inc: { attempts: 1 } },
        { new: true },
      ),
    );
  }
  const record = memoryStore.get("emailAuthChallenges", challengeHash);
  if (
    !record ||
    record.consumedAt ||
    record.expiresAt <= now ||
    record.attempts >= env.emailOtpMaxAttempts
  ) {
    return undefined;
  }
  return memoryStore.update("emailAuthChallenges", challengeHash, {
    attempts: record.attempts + 1,
  });
};

const consumeChallenge = async (challengeHash) => {
  const mode = await challengeMode();
  const now = new Date();
  if (mode === "mongodb") {
    return Boolean(
      await EmailAuthChallenge.findOneAndUpdate(
        { challengeHash, consumedAt: { $exists: false }, expiresAt: { $gt: now } },
        { $set: { consumedAt: now } },
      ),
    );
  }
  const record = memoryStore.get("emailAuthChallenges", challengeHash);
  if (!record || record.consumedAt || record.expiresAt <= now) return false;
  memoryStore.update("emailAuthChallenges", challengeHash, { consumedAt: now });
  return true;
};

const restoreChallenge = async (challengeHash) => {
  const mode = await challengeMode();
  if (mode === "mongodb") {
    await EmailAuthChallenge.updateOne(
      { challengeHash, consumedAt: { $exists: true } },
      { $unset: { consumedAt: 1 } },
    );
    return;
  }
  const record = memoryStore.get("emailAuthChallenges", challengeHash);
  if (record?.consumedAt) {
    memoryStore.update("emailAuthChallenges", challengeHash, { consumedAt: undefined });
  }
};

export const startEmailAuthentication = async ({ email, name = "", intent }) => {
  const status = emailAuthStatus();
  if (!status.enabled) {
    throw configurationError(["RESEND_API_KEY", "AUTH_EMAIL_FROM", "EMAIL_OTP_SECRET"]);
  }
  const normalizedEmail = email.trim().toLowerCase();
  const retryAfterSeconds = await recentChallengeRetryAfterSeconds(normalizedEmail);
  if (retryAfterSeconds > 0) {
    throw rateLimited(
      `Please wait ${retryAfterSeconds} seconds before requesting another code`,
      { retryAfterSeconds },
    );
  }

  const challengeId = randomBytes(32).toString("base64url");
  const challengeHash = hashChallenge(challengeId);
  const code = status.demo
    ? env.demoEmailOtpCode
    : String(randomInt(100_000, 1_000_000)).padStart(6, "0");
  const expiresInSeconds = env.emailOtpChallengeMinutes * 60;

  await saveChallenge({
    challengeHash,
    email: normalizedEmail,
    name: intent === "signup" ? name.trim() : "",
    intent,
    codeHash: hashCode(challengeHash, code),
    attempts: 0,
    expiresAt: new Date(Date.now() + expiresInSeconds * 1_000),
  });
  try {
    await emailVerificationProvider().send({
      email: normalizedEmail,
      code,
      expiresInMinutes: env.emailOtpChallengeMinutes,
    });
  } catch (error) {
    await removeChallenge(challengeHash).catch(() => {});
    throw error;
  }

  return {
    challengeId,
    email: normalizedEmail,
    emailMasked: maskEmail(normalizedEmail),
    expiresInSeconds,
    expiresInMinutes: env.emailOtpChallengeMinutes,
    resendAfterSeconds: env.emailOtpResendSeconds,
    retryAfterSeconds: env.emailOtpResendSeconds,
    ...(status.demo ? { demoCode: code, previewCode: code } : {}),
  };
};

export const verifyEmailAuthentication = async ({ challengeId, code }) => {
  const challengeHash = hashChallenge(challengeId);
  const challenge = await takeAttempt(challengeHash);
  if (!challenge) {
    throw unauthorized("This verification has expired. Request a new code");
  }
  if (!codesMatch(challenge.codeHash, hashCode(challengeHash, code))) {
    throw unauthorized("That verification code is incorrect or expired");
  }
  let consumed = false;
  try {
    return await authenticateEmailIdentity(
      {
        email: challenge.email,
        name: challenge.name,
        intent: challenge.intent,
      },
      {
        onResolved: async () => {
          if (!(await consumeChallenge(challengeHash))) {
            throw unauthorized("This verification has already been used or has expired");
          }
          consumed = true;
        },
      },
    );
  } catch (error) {
    // Account writes can still fail after resolution (for example, during a
    // transient database outage). Restore the valid challenge so the user does
    // not lose a correctly entered code. Consumed challenges also never impose
    // a resend cooldown, so recovery remains possible if restoration itself fails.
    if (consumed) await restoreChallenge(challengeHash).catch(() => {});
    throw error;
  }
};
