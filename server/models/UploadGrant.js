import mongoose from "mongoose";
import { jsonTransform } from "./helpers.js";

const uploadGrantSchema = new mongoose.Schema(
  {
    publicId: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    purpose: {
      type: String,
      required: true,
      enum: ["custom-inquiries", "orders", "products"],
    },
    reservationToken: { type: String, default: "", index: true },
    reservedAt: { type: Date },
    reservationKind: {
      type: String,
      enum: [
        "verification",
        "product-write",
        "order-write",
        "inquiry-write",
        "cleanup",
        "expired-cleanup",
      ],
    },
    verifiedAt: { type: Date },
    verifiedBytes: { type: Number, min: 1 },
    verifiedWidth: { type: Number, min: 1 },
    verifiedHeight: { type: Number, min: 1 },
    verifiedFormat: { type: String, enum: ["jpg", "jpeg", "png", "webp"] },
    verifiedVersion: { type: Number, min: 0 },
    verifiedAssetId: { type: String, default: "" },
    verifiedSecureUrl: { type: String, default: "" },
    // Grants created before authoritative provider completion was introduced do
    // not have this field and remain usable until their existing expiry.
    verificationRequired: { type: Boolean, default: true },
    consumedAt: { type: Date },
    productId: { type: String, default: "", index: true },
    orderId: { type: String, default: "", index: true },
    inquiryId: { type: String, default: "", index: true },
    deletedAt: { type: Date },
    deletedByUserId: { type: String, default: "" },
    cleanupAttempts: { type: Number, default: 0, min: 0 },
    lastCleanupAttemptAt: { type: Date },
    cleanupNotBefore: { type: Date },
    // This is deliberately a normal index, not a TTL index. Expired grants must remain until
    // Cloudinary confirms that the corresponding asset is gone.
    expiresAt: { type: Date, required: true, index: true },
  },
  { timestamps: true, toJSON: jsonTransform, toObject: jsonTransform },
);

const uploadQuotaSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true, index: true },
    count: { type: Number, required: true, min: 0 },
    windowStartedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true, expires: 0 },
  },
  { timestamps: true },
);

export const UploadGrant =
  mongoose.models.UploadGrant || mongoose.model("UploadGrant", uploadGrantSchema);
export const UploadQuota =
  mongoose.models.UploadQuota || mongoose.model("UploadQuota", uploadQuotaSchema);

export const isLegacyUploadGrantTtlIndex = (index) =>
  index?.expireAfterSeconds != null &&
  Object.keys(index.key || {}).length === 1 &&
  index.key.expiresAt === 1;

export const removeLegacyUploadGrantTtlIndexes = async (
  collection = UploadGrant.collection,
) => {
  let indexes;
  try {
    indexes = await collection.indexes();
  } catch (error) {
    if (error?.code === 26 || error?.codeName === "NamespaceNotFound") return [];
    throw error;
  }

  const removed = [];
  for (const index of indexes.filter(isLegacyUploadGrantTtlIndex)) {
    try {
      await collection.dropIndex(index.name);
      removed.push(index.name);
    } catch (error) {
      // Concurrent application instances can both observe the legacy index during a rolling
      // deployment. It is safe if another instance removed it first.
      if (error?.code !== 27 && error?.codeName !== "IndexNotFound") throw error;
    }
  }
  return removed;
};
