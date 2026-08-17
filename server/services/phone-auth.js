import { createHash, randomBytes } from "node:crypto";
import { connectDatabase } from "../config/database.js";
import { env, phoneAuthStatus } from "../config/env.js";
import {
  conflict,
  databaseUnavailable,
  rateLimited,
  unauthorized,
} from "../lib/errors.js";
import { PhoneAuthChallenge } from "../models/PhoneAuthChallenge.js";
import { maskPhone, verifyGoogleCredential } from "./auth.js";
import { phoneVerificationProvider } from "./phone-verification-provider.js";
import {
  findUserByGoogleIdentity,
  findUserByPhone,
  upsertGoogleUser,
} from "./store.js";

const MAX_CHECK_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60_000;
const memoryChallenges = new Map();

const hashChallenge = (value) => createHash("sha256").update(value).digest("hex");
const plain = (record) => (typeof record?.toJSON === "function" ? record.toJSON() : record);
export { maskPhone };

const challengeMode = async () => {
  const mode = await connectDatabase();
  if (mode === "mongodb") return mode;
  if (env.isProduction) throw databaseUnavailable();
  return "memory";
};

const hasRecentChallenge = async (googleSub, phone) => {
  const mode = await challengeMode();
  const since = new Date(Date.now() - RESEND_COOLDOWN_MS);
  if (mode === "mongodb") {
    return Boolean(
      await PhoneAuthChallenge.exists({
        $or: [{ googleSub }, { phone }],
        createdAt: { $gte: since },
      }),
    );
  }
  return [...memoryChallenges.values()].some(
    (item) => (item.googleSub === googleSub || item.phone === phone) && item.createdAt >= since,
  );
};

const saveChallenge = async (record) => {
  const mode = await challengeMode();
  if (mode === "mongodb") return plain(await PhoneAuthChallenge.create(record));
  const now = new Date();
  const stored = { ...structuredClone(record), createdAt: now, updatedAt: now };
  memoryChallenges.set(record.challengeHash, stored);
  return structuredClone(stored);
};

const takeAttempt = async (challengeHash) => {
  const mode = await challengeMode();
  const now = new Date();
  if (mode === "mongodb") {
    return plain(
      await PhoneAuthChallenge.findOneAndUpdate(
        {
          challengeHash,
          consumedAt: { $exists: false },
          expiresAt: { $gt: now },
          attempts: { $lt: MAX_CHECK_ATTEMPTS },
        },
        { $inc: { attempts: 1 } },
        { new: true },
      ),
    );
  }
  const record = memoryChallenges.get(challengeHash);
  if (
    !record ||
    record.consumedAt ||
    record.expiresAt <= now ||
    record.attempts >= MAX_CHECK_ATTEMPTS
  ) {
    return undefined;
  }
  record.attempts += 1;
  record.updatedAt = now;
  return structuredClone(record);
};

const consumeChallenge = async (challengeHash) => {
  const mode = await challengeMode();
  const now = new Date();
  if (mode === "mongodb") {
    return Boolean(
      await PhoneAuthChallenge.findOneAndUpdate(
        { challengeHash, consumedAt: { $exists: false }, expiresAt: { $gt: now } },
        { $set: { consumedAt: now } },
      ),
    );
  }
  const record = memoryChallenges.get(challengeHash);
  if (!record || record.consumedAt || record.expiresAt <= now) return false;
  record.consumedAt = now;
  record.updatedAt = now;
  return true;
};

let identityVerifier = verifyGoogleCredential;

export const setPhoneAuthIdentityVerifierForTests = (verifier) => {
  if (!env.isTest) throw new Error("Phone authentication identity test doubles are test-only");
  identityVerifier = verifier;
};

export const resetPhoneAuthForTests = () => {
  if (!env.isTest) throw new Error("Phone authentication reset is test-only");
  memoryChallenges.clear();
  identityVerifier = verifyGoogleCredential;
};

export const startPhoneAuthentication = async ({ credential, email, phone, intent }) => {
  if (!phoneAuthStatus().configured) {
    throw conflict("Phone verification awaits activation by the studio");
  }

  const profile = await identityVerifier(credential);
  if (profile.email.toLowerCase() !== email.toLowerCase()) {
    throw unauthorized("The verified Google account does not match the submitted email");
  }

  const [existing, phoneOwner] = await Promise.all([
    findUserByGoogleIdentity(profile),
    findUserByPhone(phone),
  ]);

  if (intent === "login") {
    if (existing && (!existing.phone || !existing.phoneVerifiedAt)) {
      if (phoneOwner && phoneOwner.id !== existing.id) {
        throw conflict("That mobile number is already linked to an account");
      }
    } else if (!existing?.phone || !existing.phoneVerifiedAt || existing.phone !== phone) {
      throw unauthorized("We could not verify those account details");
    }
  } else {
    if (existing?.phoneVerifiedAt) {
      throw conflict("This account is already registered. Choose log in instead");
    }
    if (phoneOwner && phoneOwner.id !== existing?.id) {
      throw conflict("That mobile number is already linked to an account");
    }
  }

  if (await hasRecentChallenge(profile.googleSub, phone)) {
    throw rateLimited("Please wait one minute before requesting another code");
  }

  const sent = await phoneVerificationProvider().start(phone);
  if (!sent) throw unauthorized("A verification code could not be sent");

  const challengeId = randomBytes(32).toString("base64url");
  const expiresInSeconds = env.phoneAuthChallengeMinutes * 60;
  await saveChallenge({
    challengeHash: hashChallenge(challengeId),
    googleSub: profile.googleSub,
    email: profile.email.toLowerCase(),
    name: profile.name,
    avatar: profile.avatar || "",
    phone,
    intent,
    attempts: 0,
    expiresAt: new Date(Date.now() + expiresInSeconds * 1_000),
  });

  return { challengeId, phoneMasked: maskPhone(phone), expiresInSeconds };
};

export const verifyPhoneAuthentication = async ({ challengeId, code }) => {
  const challengeHash = hashChallenge(challengeId);
  const challenge = await takeAttempt(challengeHash);
  if (!challenge) {
    throw unauthorized("This verification has expired. Request a new code");
  }

  const approved = await phoneVerificationProvider().check(challenge.phone, code);
  if (!approved) throw unauthorized("That verification code is incorrect or expired");

  const phoneOwner = await findUserByPhone(challenge.phone);
  if (phoneOwner && phoneOwner.googleSub !== challenge.googleSub) {
    throw conflict("That mobile number is already linked to an account");
  }

  if (!(await consumeChallenge(challengeHash))) {
    throw unauthorized("This verification has already been used or has expired");
  }

  return upsertGoogleUser({
    googleSub: challenge.googleSub,
    email: challenge.email,
    name: challenge.name,
    avatar: challenge.avatar,
    phone: challenge.phone,
    phoneVerifiedAt: new Date(),
  });
};
