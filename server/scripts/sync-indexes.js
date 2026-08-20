import "../models/AuthIdentity.js";
import "../models/Contact.js";
import "../models/CustomInquiry.js";
import "../models/EmailAuthChallenge.js";
import "../models/Order.js";
import "../models/Product.js";
import "../models/RateLimitCounter.js";
import "../models/StudioSettings.js";
import "../models/UploadGrant.js";
import "../models/User.js";
import {
  connectDatabase,
  disconnectDatabase,
  synchronizeDatabaseIndexes,
} from "../config/database.js";

try {
  const mode = await connectDatabase();
  if (mode !== "mongodb") throw new Error("MONGODB_URI is required to synchronize indexes");
  await synchronizeDatabaseIndexes();
  console.info("[database] Declared indexes and legacy index migrations are synchronized");
} finally {
  await disconnectDatabase();
}
