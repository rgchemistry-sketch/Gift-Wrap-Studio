import mongoose from "mongoose";
import { connectDatabase } from "../config/database.js";
import { env } from "../config/env.js";
import { conflict, databaseUnavailable, forbidden, notFound } from "../lib/errors.js";
import { memoryStore } from "../lib/memory-store.js";
import { Order } from "../models/Order.js";
import { Product } from "../models/Product.js";
import { ProductReview } from "../models/ProductReview.js";

const assertWritable = (mode) => {
  if (mode === "memory" && !env.allowMemoryWrites) throw databaseUnavailable();
  return mode;
};

const recordId = (record) => String(record?.id || record?._id || "");

const isoDate = (value) => {
  if (!value) return null;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
};

const safeImageUrl = (value) => {
  const candidate = String(value || "").trim();
  if (candidate.startsWith("/") && !candidate.startsWith("//") && !candidate.startsWith("/\\")) {
    return candidate.slice(0, 1_000);
  }
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" ? parsed.href.slice(0, 1_000) : "";
  } catch {
    return "";
  }
};

const safeSlug = (value) => {
  const candidate = String(value || "").trim().toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidate) ? candidate.slice(0, 160) : "";
};

export const privacySafeAuthorName = (value) => {
  const source = String(value || "").normalize("NFKC").trim();
  if (!source || source.includes("@") || /https?:\/\//i.test(source)) return "Verified buyer";
  const words = source
    .replace(/[^-\p{L}\p{M}\s.'’]/gu, " ")
    .split(/\s+/)
    .map((word) => word.replace(/^[-.'’]+|[-.'’]+$/g, ""))
    .filter(Boolean);
  if (!words.length) return "Verified buyer";
  const firstName = words[0].slice(0, 60);
  if (words.length === 1) return firstName;
  return `${firstName} ${[...words.at(-1)][0]}.`.slice(0, 100);
};

const productSnapshot = (item = {}, currentProduct = {}) => {
  const id = String(currentProduct.id || currentProduct._id || item.productId || "").slice(0, 100);
  const slug = safeSlug(currentProduct.slug || item.slug);
  const name = String(currentProduct.name || item.name || "Purchased piece").trim().slice(0, 140);
  const image = safeImageUrl(currentProduct.images?.[0]?.url || item.image);
  return {
    id,
    slug,
    name: name || "Purchased piece",
    image,
    href: slug ? `/product/${slug}` : "/shop",
  };
};

const publicReview = (review) => ({
  id: recordId(review),
  rating: Number(review.rating),
  comment: String(review.comment || ""),
  authorName: String(review.authorName || "Verified buyer"),
  verifiedPurchase: review.verifiedPurchase === true,
  product: {
    id: String(review.product?.id || ""),
    slug: String(review.product?.slug || ""),
    name: String(review.product?.name || "Purchased piece"),
    image: safeImageUrl(review.product?.image),
    href: String(review.product?.href || "/shop"),
  },
  createdAt: isoDate(review.createdAt),
  updatedAt: isoDate(review.updatedAt),
});

const deliveredAt = (order) => {
  const history = [...(order.statusHistory || [])].reverse();
  return isoDate(history.find((entry) => entry.status === "delivered")?.at || order.updatedAt || order.createdAt);
};

const deliveredOrderForProduct = async (buyerId, productId, mode) => {
  if (mode === "mongodb") {
    return Order.findOne({ buyerId, status: "delivered", "items.productId": productId })
      .sort({ updatedAt: -1 })
      .lean();
  }
  return memoryStore
    .find(
      "orders",
      (order) =>
        order.buyerId === buyerId
        && order.status === "delivered"
        && (order.items || []).some((item) => String(item.productId) === productId),
    )
    .sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt))[0];
};

const currentProductFor = async (productId, mode) => {
  if (mode === "mongodb") {
    return mongoose.isValidObjectId(productId) ? Product.findById(productId).lean() : null;
  }
  return memoryStore.get("products", productId);
};

const existingReviewFor = async (buyerId, productId, mode) => {
  if (mode === "mongodb") return ProductReview.findOne({ buyerId, productId }).lean();
  return memoryStore.findOne(
    "productReviews",
    (review) => review.buyerId === buyerId && review.productId === productId,
  );
};

const duplicateReviewError = () => conflict(
  "You have already reviewed this product. Edit your existing review instead",
);

export const createProductReview = async (buyer, input) => {
  const mode = assertWritable(await connectDatabase());
  const productId = String(input.productId);
  const order = await deliveredOrderForProduct(buyer.id, productId, mode);
  if (!order) {
    throw forbidden("A delivered purchase of this product is required before it can be reviewed");
  }
  if (await existingReviewFor(buyer.id, productId, mode)) throw duplicateReviewError();

  const item = (order.items || []).find((candidate) => String(candidate.productId) === productId);
  if (!item) {
    throw forbidden("A delivered purchase of this product is required before it can be reviewed");
  }
  const currentProduct = await currentProductFor(productId, mode);
  const now = new Date();
  const record = {
    buyerId: buyer.id,
    productId,
    deliveredOrderId: recordId(order),
    rating: input.rating,
    comment: input.comment,
    authorName: privacySafeAuthorName(buyer.name),
    product: productSnapshot(item, currentProduct || {}),
    verifiedPurchase: true,
    purchaseVerifiedAt: now,
  };

  if (mode === "memory") {
    // Keep the check and write in one synchronous turn so concurrent requests in the
    // single-process fallback cannot create two reviews for the same buyer and product.
    if (memoryStore.findOne(
      "productReviews",
      (review) => review.buyerId === buyer.id && review.productId === productId,
    )) {
      throw duplicateReviewError();
    }
    return publicReview(memoryStore.create("productReviews", record));
  }

  try {
    return publicReview(await ProductReview.create(record));
  } catch (error) {
    if (error?.code === 11_000 || error?.code === 11000) throw duplicateReviewError();
    throw error;
  }
};

export const updateOwnProductReview = async (buyerId, reviewId, input) => {
  const mode = assertWritable(await connectDatabase());
  const changes = {
    ...(input.rating !== undefined ? { rating: input.rating } : {}),
    ...(input.comment !== undefined ? { comment: input.comment } : {}),
  };
  let updated;
  if (mode === "mongodb") {
    if (!mongoose.isValidObjectId(reviewId)) throw notFound("Review");
    updated = await ProductReview.findOneAndUpdate(
      { _id: reviewId, buyerId },
      { $set: changes },
      { new: true, runValidators: true },
    );
  } else {
    const existing = memoryStore.get("productReviews", reviewId);
    if (existing?.buyerId === buyerId) {
      updated = memoryStore.update("productReviews", reviewId, changes);
    }
  }
  if (!updated) throw notFound("Review");
  return publicReview(updated);
};

export const listOwnProductReviews = async (buyerId) => {
  const mode = await connectDatabase();
  const records = mode === "mongodb"
    ? await ProductReview.find({ buyerId }).sort({ updatedAt: -1 }).lean()
    : memoryStore
      .find("productReviews", (review) => review.buyerId === buyerId)
      .sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt));
  return records.map(publicReview);
};

export const listEligibleReviewProducts = async (buyerId) => {
  const mode = await connectDatabase();
  const [orders, reviews] = mode === "mongodb"
    ? await Promise.all([
      Order.find({ buyerId, status: "delivered" }).sort({ updatedAt: -1 }).lean(),
      ProductReview.find({ buyerId }).select("productId").lean(),
    ])
    : [
      memoryStore
        .find("orders", (order) => order.buyerId === buyerId && order.status === "delivered")
        .sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt)),
      memoryStore.find("productReviews", (review) => review.buyerId === buyerId),
    ];
  const reviewedProductIds = new Set(reviews.map((review) => String(review.productId)));
  const listedProductIds = new Set();
  const products = [];
  for (const order of orders) {
    for (const item of order.items || []) {
      const productId = String(item.productId || "");
      if (!productId || reviewedProductIds.has(productId) || listedProductIds.has(productId)) continue;
      listedProductIds.add(productId);
      products.push({ product: productSnapshot(item), deliveredAt: deliveredAt(order) });
    }
  }
  return products;
};

const emptyDistribution = () => ({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });

export const getPublicProductReviews = async ({ limit }) => {
  const mode = await connectDatabase();
  let records;
  let distribution = emptyDistribution();
  if (mode === "mongodb") {
    const [recent, grouped] = await Promise.all([
      ProductReview.find({}).sort({ createdAt: -1 }).limit(limit).lean(),
      ProductReview.aggregate([
        { $group: { _id: "$rating", count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
    ]);
    records = recent;
    grouped.forEach((entry) => {
      const rating = Number(entry._id);
      if (rating >= 1 && rating <= 5) distribution[rating] = Number(entry.count);
    });
  } else {
    const all = memoryStore
      .all("productReviews")
      .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
    records = all.slice(0, limit);
    all.forEach((review) => {
      const rating = Number(review.rating);
      if (rating >= 1 && rating <= 5) distribution[rating] += 1;
    });
  }
  const totalReviews = Object.values(distribution).reduce((sum, count) => sum + count, 0);
  const ratingTotal = Object.entries(distribution)
    .reduce((sum, [rating, count]) => sum + Number(rating) * count, 0);
  return {
    summary: {
      averageRating: totalReviews ? Math.round((ratingTotal / totalReviews) * 10) / 10 : 0,
      totalReviews,
      distribution,
    },
    reviews: records.map(publicReview),
  };
};
