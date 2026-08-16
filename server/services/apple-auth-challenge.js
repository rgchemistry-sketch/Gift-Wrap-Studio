import { createHash, randomBytes } from "node:crypto";
import { connectDatabase } from "../config/database.js";
import { env } from "../config/env.js";
import { databaseUnavailable, unauthorized } from "../lib/errors.js";
import { memoryStore } from "../lib/memory-store.js";
import { AppleAuthChallenge } from "../models/AppleAuthChallenge.js";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const plain = (record) => (typeof record?.toJSON === "function" ? record.toJSON() : record);

const mode = async () => {
  const result = await connectDatabase();
  if (result === "mongodb") return result;
  if (env.isProduction) throw databaseUnavailable();
  return "memory";
};

export const issueAppleNonce = async () => {
  const storage = await mode();
  const nonceId = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const expiresInSeconds = env.authNonceMinutes * 60;
  const record = {
    challengeHash: sha256(nonceId),
    nonceHash: sha256(nonce),
    expiresAt: new Date(Date.now() + expiresInSeconds * 1_000),
  };
  if (storage === "mongodb") await AppleAuthChallenge.create(record);
  else memoryStore.create("appleAuthChallenges", record, record.challengeHash);
  return { nonceId, nonce, expiresInSeconds };
};

export const consumeAppleNonce = async (nonceId) => {
  const storage = await mode();
  const challengeHash = sha256(nonceId);
  const now = new Date();
  let record;
  if (storage === "mongodb") {
    record = plain(
      await AppleAuthChallenge.findOneAndUpdate(
        { challengeHash, consumedAt: { $exists: false }, expiresAt: { $gt: now } },
        { $set: { consumedAt: now } },
        { new: true },
      ),
    );
  } else {
    record = memoryStore.get("appleAuthChallenges", challengeHash);
    if (record && !record.consumedAt && record.expiresAt > now) {
      record = memoryStore.update("appleAuthChallenges", challengeHash, { consumedAt: now });
    } else {
      record = undefined;
    }
  }
  if (!record) throw unauthorized("This Apple sign-in request has expired. Please try again");
  return record.nonceHash;
};
