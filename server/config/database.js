import mongoose from "mongoose";
import { env } from "./env.js";
import { removeLegacyUploadGrantTtlIndexes } from "../models/UploadGrant.js";

mongoose.set("bufferCommands", false);
mongoose.set("strictQuery", true);

let status = env.mongodbUri ? "idle" : "memory";
let connectionPromise;
let lastError;
let failureCount = 0;
let retryAfter = 0;

const retryDelayMs = () => Math.min(60_000, 1_000 * 2 ** Math.min(failureCount, 6));

const safeErrorSummary = (error) => {
  const message = String(error?.message || "Unknown database error")
    .replace(/mongodb(?:\+srv)?:\/\/[^@\s]+@/gi, "mongodb://[credentials-redacted]@")
    .slice(0, 500);
  const details = [error?.name || "Error"];

  if (error?.code !== undefined) details.push(`code=${error.code}`);
  if (error?.codeName) details.push(`codeName=${error.codeName}`);
  details.push(message);

  return details.join("; ");
};

const createDeclaredIndexes = async () => {
  const models = Object.values(mongoose.models);
  await Promise.all(models.map((model) => model.createIndexes()));
};

export const databaseStatus = () => ({
  mode:
    status === "connected"
      ? "mongodb"
      : status === "connecting"
        ? "connecting"
        : status === "idle"
          ? "pending"
          : "memory",
  configured: Boolean(env.mongodbUri),
  fallbackReason: lastError ? "MongoDB was unavailable; using the in-memory demo store" : undefined,
  retryAt: retryAfter ? new Date(retryAfter).toISOString() : undefined,
});

export const connectDatabase = async () => {
  if (!env.mongodbUri) return "memory";
  if (status === "connected" && mongoose.connection.readyState === 1) return "mongodb";
  if (connectionPromise) return connectionPromise;
  if (status === "fallback" && Date.now() < retryAfter) return "memory";

  status = "connecting";
  connectionPromise = mongoose
    .connect(env.mongodbUri, {
      dbName: env.mongodbDatabase,
      serverSelectionTimeoutMS: env.mongoTimeoutMs,
      connectTimeoutMS: env.mongoTimeoutMs,
      maxPoolSize: env.isProduction ? 10 : 5,
      minPoolSize: 0,
      autoIndex: false,
    })
    .then(async () => {
      // Older releases declared UploadGrant.expiresAt as a TTL index. Remove that index before
      // creating the current normal lookup index so MongoDB never drops asset provenance before
      // the Cloudinary cleanup worker has confirmed deletion.
      await removeLegacyUploadGrantTtlIndexes();
      await createDeclaredIndexes();
      status = "connected";
      lastError = undefined;
      failureCount = 0;
      retryAfter = 0;
      return "mongodb";
    })
    .catch(async (error) => {
      lastError = error;
      failureCount += 1;
      retryAfter = Date.now() + retryDelayMs();
      status = "fallback";
      if (mongoose.connection.readyState !== 0) {
        try {
          await mongoose.disconnect();
        } catch {
          // A later bounded retry will make another clean connection attempt.
        }
      }
      if (!env.isTest) {
        console.warn(
          `[database] MongoDB unavailable (${safeErrorSummary(error)}); using demo data and retrying later.`,
        );
      }
      return "memory";
    })
    .finally(() => {
      connectionPromise = undefined;
    });

  return connectionPromise;
};

export const disconnectDatabase = async () => {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  status = env.mongodbUri ? "idle" : "memory";
  connectionPromise = undefined;
  lastError = undefined;
  failureCount = 0;
  retryAfter = 0;
};
