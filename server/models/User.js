import mongoose from "mongoose";
import { jsonTransform } from "./helpers.js";

const userSchema = new mongoose.Schema(
  {
    // Retained for lazy migration of accounts created before generic identities existed.
    googleSub: { type: String, unique: true, sparse: true, index: true, trim: true },
    email: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
    emailVerifiedAt: { type: Date },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    avatar: { type: String, default: "", trim: true },
    phone: { type: String, sparse: true, unique: true, index: true, trim: true },
    phoneVerifiedAt: { type: Date },
    role: { type: String, enum: ["buyer", "admin"], default: "buyer", index: true },
    providers: {
      type: [{ type: String, enum: ["email", "google", "facebook", "apple"] }],
      default: [],
    },
    sessionVersion: { type: Number, default: 0, min: 0 },
    lastLoginAt: { type: Date, default: Date.now },
  },
  { timestamps: true, toJSON: jsonTransform, toObject: jsonTransform },
);

export const User = mongoose.models.User || mongoose.model("User", userSchema);

export const isLegacyGoogleSubIndex = (index) =>
  index?.name === "googleSub_1" &&
  index?.unique === true &&
  index?.sparse !== true &&
  Object.keys(index.key || {}).length === 1 &&
  index.key.googleSub === 1;

export const removeLegacyUserIdentityIndexes = async (collection = User.collection) => {
  let indexes;
  try {
    indexes = await collection.indexes();
  } catch (error) {
    if (error?.code === 26 || error?.codeName === "NamespaceNotFound") return [];
    throw error;
  }

  const removed = [];
  for (const index of indexes.filter(isLegacyGoogleSubIndex)) {
    try {
      await collection.dropIndex(index.name);
      removed.push(index.name);
    } catch (error) {
      // Multiple serverless instances may run this migration together. A concurrent removal is
      // successful for our purposes and the sparse replacement is created immediately afterward.
      if (error?.code !== 27 && error?.codeName !== "IndexNotFound") throw error;
    }
  }
  return removed;
};
