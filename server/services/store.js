import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { connectDatabase } from "../config/database.js";
import { env } from "../config/env.js";
import { demoProducts } from "../data/demo-products.js";
import {
  badRequest,
  conflict,
  databaseUnavailable,
  forbidden,
  idempotencyKeyReused,
  notFound,
  rateLimited,
  unauthorized,
  welcomeOfferExcluded,
  welcomeOfferIneligible,
  welcomeOfferInvalid,
} from "../lib/errors.js";
import { memoryStore } from "../lib/memory-store.js";
import { maskPhone } from "./auth.js";
import { Contact } from "../models/Contact.js";
import { CustomInquiry } from "../models/CustomInquiry.js";
import { Order } from "../models/Order.js";
import { Product } from "../models/Product.js";
import { StudioSettings } from "../models/StudioSettings.js";
import { User } from "../models/User.js";
import { UploadGrant, UploadQuota } from "../models/UploadGrant.js";
import { AuthIdentity } from "../models/AuthIdentity.js";
import { normalizeInstagramProfile } from "../../shared/social-profiles.js";

const clone = (value) => (value == null ? value : structuredClone(value));

let uploadGrantConsumptionHookForTests;
let uploadGrantReservationConflictHookForTests;

export const setUploadGrantConsumptionHookForTests = (hook) => {
  if (!env.isTest) throw new Error("Upload grant consumption hooks are test-only");
  uploadGrantConsumptionHookForTests = hook;
};

export const resetUploadGrantConsumptionHookForTests = () => {
  if (!env.isTest) throw new Error("Upload grant consumption hooks are test-only");
  uploadGrantConsumptionHookForTests = undefined;
};

export const setUploadGrantReservationConflictHookForTests = (hook) => {
  if (!env.isTest) throw new Error("Upload grant reservation hooks are test-only");
  uploadGrantReservationConflictHookForTests = hook;
};

export const resetUploadGrantReservationConflictHookForTests = () => {
  if (!env.isTest) throw new Error("Upload grant reservation hooks are test-only");
  uploadGrantReservationConflictHookForTests = undefined;
};

const plain = (record) => {
  if (!record) return undefined;
  if (typeof record.toJSON === "function") return record.toJSON();
  const value = { ...record };
  if (value._id) {
    value.id = String(value._id);
    delete value._id;
  }
  delete value.__v;
  return clone(value);
};

const publicOrder = (record) => {
  const value = plain(record);
  if (!value) return value;
  delete value.idempotencyKey;
  delete value.idempotencyHash;
  delete value.inventoryReservations;
  delete value.inventoryReleasedAt;
  delete value.writePending;
  return value;
};

const paginate = (items, page, limit, total = items.length) => ({
  items,
  page,
  limit,
  total,
  totalPages: total === 0 ? 0 : Math.ceil(total / limit),
});

const slicePage = (items, page, limit) => items.slice((page - 1) * limit, page * limit);

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const assertWritable = (mode) => {
  if (mode === "memory" && !env.allowMemoryWrites) throw databaseUnavailable();
  return mode;
};

const restoreMemoryRecord = (collection, record) => {
  memoryStore.remove(collection, record.id);
  return memoryStore.create(collection, record, record.id);
};

let mongoSeedPromise;

// Catalogues seeded before `occasion` existed have no value for it, which would leave the
// storefront's occasion navigation empty. Fill in the seeded pieces only where the field is
// still unset so an administrator's own choice is never overwritten.
const backfillSeededOccasions = async () => {
  const operations = demoProducts
    .filter((product) => product.occasion)
    .map((product) => ({
      updateOne: {
        filter: {
          slug: product.slug,
          $or: [{ occasion: { $exists: false } }, { occasion: "" }, { occasion: null }],
        },
        update: { $set: { occasion: product.occasion } },
      },
    }));
  if (!operations.length) return;
  await Product.bulkWrite(operations, { ordered: false });
};

export const ensureCatalogSeeded = async () => {
  const mode = await connectDatabase();

  if (mode === "mongodb") {
    if (!mongoSeedPromise) {
      mongoSeedPromise = (async () => {
        if ((await Product.estimatedDocumentCount()) > 0) {
          await backfillSeededOccasions();
          return;
        }
        const seeds = demoProducts.map(({ id: _id, ...product }) => product);
        try {
          await Product.insertMany(seeds, { ordered: false });
        } catch (error) {
          if (error?.code !== 11_000 && error?.code !== 11000) throw error;
          await backfillSeededOccasions();
        }
      })().catch((error) => {
        mongoSeedPromise = undefined;
        throw error;
      });
    }
    await mongoSeedPromise;
    return mode;
  }

  if (memoryStore.count("products") === 0) {
    demoProducts.forEach((product) => memoryStore.create("products", product, product.id));
  }
  return mode;
};

export const listProducts = async ({ search, category, occasion, featured, page, limit }) => {
  const mode = await ensureCatalogSeeded();

  if (mode === "mongodb") {
    const query = { active: true };
    if (category) query.category = category;
    if (occasion) query.occasion = occasion;
    if (featured !== undefined) query.featured = featured;
    if (search) {
      const pattern = new RegExp(escapeRegExp(search), "i");
      query.$or = [{ name: pattern }, { shortDescription: pattern }, { tags: pattern }];
    }

    const [records, total] = await Promise.all([
      Product.find(query)
        .sort({ sortOrder: 1, featured: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Product.countDocuments(query),
    ]);
    return paginate(records.map(plain), page, limit, total);
  }

  const needle = search?.toLowerCase();
  const filtered = memoryStore
    .all("products")
    .filter((product) => product.active)
    .filter((product) => !category || product.category === category)
    .filter((product) => !occasion || product.occasion === occasion)
    .filter((product) => featured === undefined || product.featured === featured)
    .filter(
      (product) =>
        !needle ||
        [product.name, product.shortDescription, ...(product.tags || [])]
          .join(" ")
          .toLowerCase()
          .includes(needle),
    )
    // Mirror the MongoDB sort exactly so both persistence modes page identically.
    .sort(
      (a, b) =>
        a.sortOrder - b.sortOrder ||
        Number(b.featured) - Number(a.featured) ||
        new Date(b.createdAt) - new Date(a.createdAt),
    );
  return paginate(slicePage(filtered, page, limit), page, limit, filtered.length);
};

export const listProductCategories = async () => {
  const mode = await ensureCatalogSeeded();
  const categories =
    mode === "mongodb"
      ? await Product.distinct("category", { active: true })
      : [...new Set(memoryStore.find("products", (product) => product.active).map((item) => item.category))];
  return categories.sort((a, b) => a.localeCompare(b));
};

export const getProductBySlug = async (slug, { includeInactive = false } = {}) => {
  const mode = await ensureCatalogSeeded();
  const record =
    mode === "mongodb"
      ? await Product.findOne({ slug, ...(includeInactive ? {} : { active: true }) })
      : memoryStore.findOne(
          "products",
          (product) => product.slug === slug && (includeInactive || product.active),
        );
  if (!record) throw notFound("Product");
  return plain(record);
};

const adminProductStatusQuery = (status) => {
  if (status === "current") return { archivedAt: null };
  if (status === "published") return { archivedAt: null, active: true };
  if (status === "draft") return { archivedAt: null, active: false };
  if (status === "archived") return { archivedAt: { $ne: null } };
  return {};
};

const matchesAdminProductStatus = (product, status) => {
  const archived = product.archivedAt != null;
  if (status === "current") return !archived;
  if (status === "published") return !archived && product.active === true;
  if (status === "draft") return !archived && product.active === false;
  if (status === "archived") return archived;
  return true;
};

const adminProductListItem = (record) => {
  const product = plain(record);
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    category: product.category,
    sku: product.sku,
    price: product.price,
    compareAtPrice: product.compareAtPrice,
    images: (product.images || []).slice(0, 1),
    featured: product.featured,
    active: product.active,
    inventory: product.inventory,
    sortOrder: product.sortOrder,
    archivedAt: product.archivedAt,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
};

export const listAllProductsForAdmin = async ({ q, status = "all", page = 1, limit = 20 } = {}) => {
  const mode = await ensureCatalogSeeded();

  if (mode === "mongodb") {
    const query = adminProductStatusQuery(status);
    if (q) {
      const pattern = new RegExp(escapeRegExp(q), "i");
      query.$or = [
        { name: pattern },
        { category: pattern },
        { occasion: pattern },
        { sku: pattern },
        { slug: pattern },
        { tags: pattern },
      ];
    }
    const [records, total] = await Promise.all([
      Product.find(query)
        .select(
          "slug name category sku price compareAtPrice images featured active inventory sortOrder archivedAt createdAt updatedAt",
        )
        .slice("images", 1)
        .sort({ active: -1, sortOrder: 1, createdAt: -1, _id: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Product.countDocuments(query),
    ]);
    return paginate(records.map(adminProductListItem), page, limit, total);
  }

  const needle = q?.toLowerCase();
  const filtered = memoryStore
    .all("products")
    .filter((product) => matchesAdminProductStatus(product, status))
    .filter(
      (product) =>
        !needle ||
        [
          product.name,
          product.category,
          product.occasion,
          product.sku,
          product.slug,
          ...(product.tags || []),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(needle),
    )
    .sort(
      (a, b) =>
        Number(b.active) - Number(a.active) ||
        Number(a.sortOrder || 0) - Number(b.sortOrder || 0) ||
        new Date(b.createdAt) - new Date(a.createdAt) ||
        String(a.id).localeCompare(String(b.id)),
    );
  return paginate(
    slicePage(filtered, page, limit).map(adminProductListItem),
    page,
    limit,
    filtered.length,
  );
};

export const getProductForAdmin = async (id) => {
  const mode = await ensureCatalogSeeded();
  const record =
    mode === "mongodb"
      ? mongoose.isValidObjectId(id)
        ? await Product.findById(id)
        : undefined
      : memoryStore.get("products", id);
  if (!record) throw notFound("Product");
  return plain(record);
};

const productSkus = (product) =>
  [product.sku, ...(product.variants || []).map((variant) => variant.sku)].filter(Boolean);

const productImagePublicIds = (product) =>
  (product.images || []).map((image) => image.publicId).filter(Boolean);

const cloudinaryUrlMatchesPublicId = (imageUrl, publicId) => {
  if (!env.cloudinaryCloudName) return false;
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(imageUrl.pathname);
  } catch {
    return false;
  }
  const uploadPrefix = `/${env.cloudinaryCloudName}/image/upload/`;
  if (!decodedPath.startsWith(uploadPrefix)) return false;
  const deliveryPath = decodedPath.slice(uploadPrefix.length);
  const versionMarker = /(?:^|\/)v\d+\//g;
  let versionMatch;
  let latestVersionMatch;
  while ((versionMatch = versionMarker.exec(deliveryPath))) {
    latestVersionMatch = versionMatch;
  }
  const deliveredAsset = latestVersionMatch
    ? deliveryPath.slice(latestVersionMatch.index + latestVersionMatch[0].length)
    : deliveryPath;
  return new RegExp(`^${escapeRegExp(publicId)}(?:\\.[A-Za-z0-9]+)?$`).test(deliveredAsset);
};

const orderCustomizationPublicIds = (items) =>
  items.flatMap((item, index) => {
    if (!item.customization) return [];
    let customization;
    try {
      customization = JSON.parse(item.customization);
    } catch {
      return [];
    }
    if (
      !customization ||
      typeof customization !== "object" ||
      Array.isArray(customization) ||
      !Object.hasOwn(customization, "media") ||
      customization.media == null
    ) {
      return [];
    }
    const field = `items.${index}.customization`;
    const media = customization.media;
    if (!media || typeof media !== "object" || Array.isArray(media)) {
      throw badRequest("Customization media must be a securely uploaded image", [{ field }]);
    }
    if (media.pending) {
      throw badRequest("Finish uploading the customization image before placing the order", [
        { field },
      ]);
    }
    const url = typeof media.url === "string" ? media.url.trim() : "";
    const publicId = typeof media.publicId === "string" ? media.publicId.trim() : "";
    if (!url || !publicId) {
      throw badRequest("Customization media must include its secure URL and upload public ID", [
        { field },
      ]);
    }
    let imageUrl;
    try {
      imageUrl = new URL(url);
    } catch {
      throw badRequest("Customization media has an invalid image URL", [{ field }]);
    }
    if (
      imageUrl.protocol !== "https:" ||
      imageUrl.hostname.toLowerCase() !== "res.cloudinary.com" ||
      !cloudinaryUrlMatchesPublicId(imageUrl, publicId)
    ) {
      throw badRequest("The customization image URL does not match its upload public ID", [
        { field },
      ]);
    }
    return [publicId];
  });

const assertProductInvariants = (product) => {
  if (product.compareAtPrice != null && product.compareAtPrice < product.price) {
    throw badRequest("Compare-at price must be at least the selling price", [
      { field: "compareAtPrice" },
    ]);
  }
  const skus = productSkus(product);
  if (new Set(skus).size !== skus.length) {
    throw conflict("Every SKU in a product must be unique", [{ field: "variants" }]);
  }
  const imagePublicIds = productImagePublicIds(product);
  if (new Set(imagePublicIds).size !== imagePublicIds.length) {
    throw conflict("Every uploaded product image must be unique", [{ field: "images" }]);
  }
  for (const [index, image] of (product.images || []).entries()) {
    if (!image.publicId) continue;
    let imageUrl;
    try {
      imageUrl = new URL(image.url);
    } catch {
      throw badRequest("Cloudinary product images require an HTTPS URL", [
        { field: `images.${index}.url` },
      ]);
    }
    if (
      imageUrl.protocol !== "https:" ||
      imageUrl.hostname.toLowerCase() !== "res.cloudinary.com" ||
      !cloudinaryUrlMatchesPublicId(imageUrl, image.publicId)
    ) {
      throw badRequest("The product image URL does not match its reserved Cloudinary public ID", [
        { field: `images.${index}` },
      ]);
    }
  }
};

const assertProductSkusAvailable = async (candidate, mode, excludedId) => {
  const skus = productSkus(candidate);
  if (!skus.length) return;
  const duplicate =
    mode === "mongodb"
      ? await Product.findOne({
          ...(excludedId ? { _id: { $ne: excludedId } } : {}),
          $or: [{ sku: { $in: skus } }, { "variants.sku": { $in: skus } }],
        }).select("_id")
      : memoryStore.findOne(
          "products",
          (product) =>
            product.id !== excludedId && productSkus(product).some((sku) => skus.includes(sku)),
        );
  if (duplicate) {
    throw conflict("A product or variant already uses one of these SKUs", [{ field: "sku" }]);
  }
};

export const createProduct = async (input, { userId } = {}) => {
  const mode = assertWritable(await ensureCatalogSeeded());
  assertProductInvariants(input);
  await assertProductSkusAvailable(input, mode);
  const publicIds = productImagePublicIds(input);
  if (publicIds.length && !userId) {
    throw forbidden("An authenticated administrator must own every uploaded product image");
  }
  const reservation = await reserveProductImageGrants({ userId, publicIds });
  if (mode === "mongodb") {
    let session;
    let product;
    try {
      session = await mongoose.startSession();
      await session.withTransaction(async () => {
        [product] = await Product.create([input], { session });
        await consumeProductImageGrants({
          reservationToken: reservation?.reservationToken,
          productId: product.id,
          expectedCount: publicIds.length,
          session,
          mode,
        });
      });
      if (!product) throw conflict("The product could not be created");
      return plain(product);
    } catch (error) {
      await releaseUploadGrantReservation(reservation?.reservationToken).catch(() => {});
      throw error;
    } finally {
      await session?.endSession();
    }
  }

  let product;
  try {
    if (memoryStore.findOne("products", (item) => item.slug === input.slug)) {
      throw conflict("A product with this slug already exists", [{ field: "slug" }]);
    }
    product = memoryStore.create("products", input);
    await consumeProductImageGrants({
      reservationToken: reservation?.reservationToken,
      productId: product.id,
      expectedCount: publicIds.length,
      mode,
    });
    return product;
  } catch (error) {
    if (product) memoryStore.remove("products", product.id);
    await releaseUploadGrantReservation(reservation?.reservationToken).catch(() => {});
    throw error;
  }
};

export const updateProduct = async (id, input, { userId } = {}) => {
  const mode = assertWritable(await ensureCatalogSeeded());
  const changes = input.active === true ? { ...input, archivedAt: null } : input;
  if (mode === "mongodb" && !mongoose.isValidObjectId(id)) throw notFound("Product");
  const existing =
    mode === "mongodb" ? plain(await Product.findById(id)) : memoryStore.get("products", id);
  if (!existing) throw notFound("Product");
  const candidate = { ...existing, ...changes };
  assertProductInvariants(candidate);
  await assertProductSkusAvailable(
    candidate,
    mode,
    mode === "mongodb" ? new mongoose.Types.ObjectId(id) : id,
  );
  if (
    mode === "memory" &&
    input.slug &&
    memoryStore.findOne("products", (product) => product.slug === input.slug && product.id !== id)
  ) {
    throw conflict("A product with this slug already exists", [{ field: "slug" }]);
  }

  const retainedPublicIds = new Set(productImagePublicIds(existing));
  const newPublicIds = productImagePublicIds(candidate).filter(
    (publicId) => !retainedPublicIds.has(publicId),
  );
  if (newPublicIds.length && !userId) {
    throw forbidden("An authenticated administrator must own every new uploaded product image");
  }
  const reservation = await reserveProductImageGrants({ userId, publicIds: newPublicIds });
  if (mode === "mongodb") {
    let session;
    let product;
    try {
      session = await mongoose.startSession();
      await session.withTransaction(async () => {
        const record = await Product.findByIdAndUpdate(
          id,
          { $set: changes },
          { new: true, runValidators: true, session },
        );
        if (!record) throw notFound("Product");
        product = plain(record);
        await consumeProductImageGrants({
          reservationToken: reservation?.reservationToken,
          productId: product.id,
          expectedCount: newPublicIds.length,
          session,
          mode,
        });
      });
      if (!product) throw conflict("The product could not be updated");
      return product;
    } catch (error) {
      await releaseUploadGrantReservation(reservation?.reservationToken).catch(() => {});
      throw error;
    } finally {
      await session?.endSession();
    }
  }

  let written = false;
  try {
    const record = memoryStore.update("products", id, changes);
    if (!record) throw notFound("Product");
    written = true;
    await consumeProductImageGrants({
      reservationToken: reservation?.reservationToken,
      productId: record.id,
      expectedCount: newPublicIds.length,
      mode,
    });
    return record;
  } catch (error) {
    if (written) restoreMemoryRecord("products", existing);
    await releaseUploadGrantReservation(reservation?.reservationToken).catch(() => {});
    throw error;
  }
};

export const archiveProduct = async (id) =>
  updateProduct(id, { active: false, archivedAt: new Date() });

export const upsertGoogleUser = async ({ googleSub, email, name, avatar, phone, phoneVerifiedAt }) => {
  const mode = assertWritable(await connectDatabase());
  const normalizedEmail = email.toLowerCase();
  const role = env.adminEmail && normalizedEmail === env.adminEmail ? "admin" : "buyer";

  if (mode === "mongodb") {
    const demotionQuery = env.adminEmail
      ? { role: "admin", email: { $ne: env.adminEmail } }
      : { role: "admin" };
    await User.updateMany(demotionQuery, { $set: { role: "buyer" } });

    let record = await User.findOne({ $or: [{ googleSub }, { email: normalizedEmail }] });
    if (record) {
      Object.assign(record, {
        googleSub,
        email: normalizedEmail,
        emailVerifiedAt: record.emailVerifiedAt || new Date(),
        name,
        avatar: avatar || "",
        role,
        providers: [...new Set([...(record.providers || []), "google"])],
        lastLoginAt: new Date(),
        ...(phone ? { phone, phoneVerifiedAt: phoneVerifiedAt || new Date() } : {}),
      });
      await record.save();
    } else {
      record = await User.create({
        googleSub,
        email: normalizedEmail,
        emailVerifiedAt: new Date(),
        name,
        avatar: avatar || "",
        role,
        providers: ["google"],
        sessionVersion: 0,
        lastLoginAt: new Date(),
        ...(phone ? { phone, phoneVerifiedAt: phoneVerifiedAt || new Date() } : {}),
      });
    }
    return plain(record);
  }

  memoryStore
    .find("users", (user) => user.role === "admin" && user.email !== env.adminEmail)
    .forEach((user) => memoryStore.update("users", user.id, { role: "buyer" }));
  let record = memoryStore.findOne(
    "users",
    (user) => user.googleSub === googleSub || user.email === normalizedEmail,
  );
  const changes = {
    googleSub,
    email: normalizedEmail,
    emailVerifiedAt: record?.emailVerifiedAt || new Date(),
    name,
    avatar: avatar || "",
    role,
    providers: [...new Set([...(record?.providers || []), "google"])],
    sessionVersion: record?.sessionVersion || 0,
    lastLoginAt: new Date(),
    ...(phone ? { phone, phoneVerifiedAt: phoneVerifiedAt || new Date() } : {}),
  };
  record = record ? memoryStore.update("users", record.id, changes) : memoryStore.create("users", changes);
  return record;
};

const cloudinaryPublicIdFromUrl = (value) => {
  if (String(value || "").startsWith("/")) return "";
  let imageUrl;
  let decodedPath;
  try {
    imageUrl = new URL(value);
    decodedPath = decodeURIComponent(imageUrl.pathname);
  } catch {
    return "";
  }
  if (
    imageUrl.protocol !== "https:" ||
    imageUrl.hostname.toLowerCase() !== "res.cloudinary.com" ||
    !env.cloudinaryCloudName
  ) {
    return "";
  }
  const uploadPrefix = `/${env.cloudinaryCloudName}/image/upload/`;
  if (!decodedPath.startsWith(uploadPrefix)) return "";
  const deliveryPath = decodedPath.slice(uploadPrefix.length);
  const versionMarker = /(?:^|\/)v\d+\//g;
  let versionMatch;
  let latestVersionMatch;
  while ((versionMatch = versionMarker.exec(deliveryPath))) latestVersionMatch = versionMatch;
  const deliveredAsset = latestVersionMatch
    ? deliveryPath.slice(latestVersionMatch.index + latestVersionMatch[0].length)
    : deliveryPath;
  return deliveredAsset.replace(/\.[A-Za-z0-9]+$/, "");
};

export const upsertDemoUser = async (requestedRole = "buyer") => {
  const mode = assertWritable(await connectDatabase());
  const role = requestedRole === "admin" ? "admin" : "buyer";
  const email = `preview-${role}@giftnwrap.local`;
  const now = new Date();
  const changes = {
    email,
    emailVerifiedAt: now,
    name: role === "admin" ? "Preview Administrator" : "Preview Buyer",
    avatar: "",
    role,
    providers: ["demo"],
    lastLoginAt: now,
  };

  // Demo identities live under reserved local-only addresses. In particular,
  // never upsert by ADMIN_EMAIL: doing so would overwrite the real administrator
  // account's name, avatar and Google subject in a shared development database.
  if (mode === "mongodb") {
    return plain(
      await User.findOneAndUpdate(
        { email },
        { $set: changes, $setOnInsert: { sessionVersion: 0 } },
        { new: true, upsert: true, runValidators: true },
      ),
    );
  }

  const existing = memoryStore.findOne("users", (user) => user.email === email);
  return existing
    ? memoryStore.update("users", existing.id, changes)
    : memoryStore.create("users", { ...changes, sessionVersion: 0 });
};

export const findUserByGoogleIdentity = async ({ googleSub, email }) => {
  const mode = await connectDatabase();
  const normalizedEmail = email.toLowerCase();
  if (mode === "mongodb") {
    return plain(await User.findOne({ $or: [{ googleSub }, { email: normalizedEmail }] }));
  }
  return memoryStore.findOne(
    "users",
    (user) => user.googleSub === googleSub || user.email === normalizedEmail,
  );
};

export const findUserByPhone = async (phone) => {
  const mode = await connectDatabase();
  if (mode === "mongodb") return plain(await User.findOne({ phone }));
  return memoryStore.findOne("users", (user) => user.phone === phone);
};

export const getUserById = async (id) => {
  const mode = await connectDatabase();
  if (mode === "mongodb") {
    if (!mongoose.isValidObjectId(id)) return undefined;
    return plain(await User.findById(id));
  }
  return memoryStore.get("users", id);
};

const identityKey = (provider, subject) => `${provider}:${subject}`;
const normalizedProviders = (providers = []) =>
  [...new Set(
    providers
      .map((provider) => String(provider || "").trim().toLowerCase())
      .filter((provider) => /^[a-z0-9_-]{1,50}$/.test(provider)),
  )];

const plainIdentity = (record) => {
  const value = plain(record);
  if (value?.userId) value.userId = String(value.userId);
  return value;
};

export const getUserByEmail = async (email) => {
  const mode = await connectDatabase();
  const normalizedEmail = email.toLowerCase();
  if (mode === "mongodb") return plain(await User.findOne({ email: normalizedEmail }));
  return memoryStore.findOne("users", (user) => user.email === normalizedEmail);
};

export const getLegacyGoogleUserBySubject = async (googleSub) => {
  const mode = await connectDatabase();
  if (mode === "mongodb") return plain(await User.findOne({ googleSub }));
  return memoryStore.findOne("users", (user) => user.googleSub === googleSub);
};

export const getAuthIdentity = async (provider, subject) => {
  const mode = await connectDatabase();
  if (mode === "mongodb") {
    return plainIdentity(await AuthIdentity.findOne({ provider, subject }));
  }
  return memoryStore.get("authIdentities", identityKey(provider, subject));
};

export const getUserByAuthIdentity = async (provider, subject) => {
  const identity = await getAuthIdentity(provider, subject);
  return identity ? getUserById(identity.userId) : undefined;
};

export const createUserWithAuthIdentity = async ({
  provider,
  subject,
  email,
  emailVerified,
  name,
  avatar,
}) => {
  const mode = assertWritable(await connectDatabase());
  const normalizedEmail = email.toLowerCase();
  const adminEligibleProvider = ["email", "google"].includes(provider);
  const role =
    adminEligibleProvider && env.adminEmail && normalizedEmail === env.adminEmail
      ? "admin"
      : "buyer";
  const now = new Date();
  const userInput = {
    email: normalizedEmail,
    ...(emailVerified ? { emailVerifiedAt: now } : {}),
    name: name?.trim() || normalizedEmail.split("@")[0],
    avatar: avatar || "",
    role,
    providers: [provider],
    sessionVersion: 0,
    lastLoginAt: now,
    ...(provider === "google" ? { googleSub: subject } : {}),
  };

  if (mode === "mongodb") {
    const user = await User.create(userInput);
    try {
      await AuthIdentity.create({
        userId: user._id,
        provider,
        subject,
        providerEmail: normalizedEmail,
        emailVerified: Boolean(emailVerified),
        lastUsedAt: now,
      });
    } catch (error) {
      await User.findByIdAndDelete(user._id).catch(() => {});
      throw error;
    }
    return plain(user);
  }

  if (memoryStore.findOne("users", (user) => user.email === normalizedEmail)) {
    throw conflict("An account already uses this email address");
  }
  if (memoryStore.get("authIdentities", identityKey(provider, subject))) {
    throw conflict("That sign-in identity is already connected to an account");
  }
  const user = memoryStore.create("users", userInput);
  memoryStore.create(
    "authIdentities",
    {
      userId: user.id,
      provider,
      subject,
      providerEmail: normalizedEmail,
      emailVerified: Boolean(emailVerified),
      lastUsedAt: now,
    },
    identityKey(provider, subject),
  );
  return user;
};

export const linkAuthIdentity = async ({
  userId,
  provider,
  subject,
  providerEmail = "",
  emailVerified = false,
}) => {
  const mode = assertWritable(await connectDatabase());
  const existing = await getAuthIdentity(provider, subject);
  if (existing && existing.userId !== String(userId)) {
    throw conflict("That sign-in identity is already connected to another account");
  }
  const now = new Date();

  if (mode === "mongodb") {
    if (!mongoose.isValidObjectId(userId)) throw notFound("User");
    if (!existing) {
      await AuthIdentity.create({
        userId,
        provider,
        subject,
        providerEmail: providerEmail.toLowerCase(),
        emailVerified: Boolean(emailVerified),
        lastUsedAt: now,
      });
    } else {
      await AuthIdentity.findByIdAndUpdate(existing.id, {
        $set: {
          providerEmail: providerEmail.toLowerCase(),
          emailVerified: Boolean(existing.emailVerified || emailVerified),
          lastUsedAt: now,
        },
      });
    }
    const user = await User.findByIdAndUpdate(
      userId,
      { $addToSet: { providers: provider } },
      { new: true, runValidators: true },
    );
    if (!user) throw notFound("User");
    return plain(user);
  }

  if (!existing) {
    memoryStore.create(
      "authIdentities",
      {
        userId: String(userId),
        provider,
        subject,
        providerEmail: providerEmail.toLowerCase(),
        emailVerified: Boolean(emailVerified),
        lastUsedAt: now,
      },
      identityKey(provider, subject),
    );
  } else {
    memoryStore.update("authIdentities", existing.id, {
      providerEmail: providerEmail.toLowerCase(),
      emailVerified: Boolean(existing.emailVerified || emailVerified),
      lastUsedAt: now,
    });
  }
  const user = memoryStore.get("users", userId);
  if (!user) throw notFound("User");
  return memoryStore.update("users", userId, {
    providers: normalizedProviders([...(user.providers || []), provider]),
  });
};

export const touchAuthenticatedUser = async (
  userId,
  { provider, subject = "", providerEmail = "", emailVerified = false, name, avatar } = {},
) => {
  const mode = assertWritable(await connectDatabase());
  const existing = await getUserById(userId);
  if (!existing) throw notFound("User");
  const normalizedProviderEmail = providerEmail.toLowerCase();
  const verifiesPrimaryEmail =
    emailVerified && normalizedProviderEmail && normalizedProviderEmail === existing.email;
  const adminEligible = existing.role === "admin" || ["email", "google"].includes(provider);
  const changes = {
    role:
      adminEligible && env.adminEmail && existing.email === env.adminEmail
        ? "admin"
        : "buyer",
    providers: normalizedProviders([...(existing.providers || []), provider]),
    lastLoginAt: new Date(),
    ...(name?.trim() ? { name: name.trim() } : {}),
    ...(avatar ? { avatar } : {}),
    ...(verifiesPrimaryEmail && !existing.emailVerifiedAt ? { emailVerifiedAt: new Date() } : {}),
  };
  if (provider === "google" && !existing.googleSub) {
    const identity = await getAuthIdentity(provider, subject);
    if (identity?.subject) changes.googleSub = identity.subject;
  }

  if (mode === "mongodb") {
    return plain(
      await User.findByIdAndUpdate(userId, { $set: changes }, { new: true, runValidators: true }),
    );
  }
  return memoryStore.update("users", userId, changes);
};

export const revokeUserSessions = async (userId) => {
  const mode = assertWritable(await connectDatabase());
  if (mode === "mongodb") {
    const user = await User.findByIdAndUpdate(
      userId,
      { $inc: { sessionVersion: 1 } },
      { new: true, runValidators: true },
    );
    if (!user) throw notFound("User");
    return plain(user);
  }
  const user = memoryStore.get("users", userId);
  if (!user) throw notFound("User");
  return memoryStore.update("users", userId, {
    sessionVersion: Number(user.sessionVersion || 0) + 1,
  });
};

const welcomeOfferHasValue = (offer = {}) =>
  Number(offer.percent) > 0 && Number(offer.maxDiscount) > 0;

const defaultStudioSettings = () => ({
  leadTimes: {
    ready: "3–10 business days",
    custom: "5–15 business days",
  },
  offer: {
    enabled: env.welcomeDiscountPercent > 0 && env.welcomeDiscountMax > 0,
    eyebrow: "A little welcome gift",
    title: "Make your first story together.",
    body: "Enjoy a thoughtful saving on your first Gift N Wrap Studio order.",
    code: env.welcomeCouponCode,
    percent: env.welcomeDiscountPercent,
    maxDiscount: env.welcomeDiscountMax,
    delaySeconds: 0,
  },
  shipping: {
    flatFee: env.flatShippingFee,
    freeThreshold: env.freeShippingThreshold,
    bulkThreshold: env.bulkOrderThreshold,
  },
  announcement: {
    enabled: true,
    text: "Every piece handmade with care",
    linkLabel: "PAN India delivery",
    linkUrl: "/shop",
  },
  contact: {
    email: "info@giftnwrapstudio.com",
    phone: "+919588281126",
    instagram: "@giftnwrapstudio",
  },
});

const mergeStudioSettings = (current = {}, changes = {}) => {
  const defaults = defaultStudioSettings();
  return Object.fromEntries(
    Object.entries(defaults).map(([group, fallback]) => [
      group,
      Object.fromEntries(
        Object.keys(fallback).map((key) => {
          const currentGroup = current[group] || {};
          const changesGroup = changes[group] || {};
          if (Object.prototype.hasOwnProperty.call(changesGroup, key)) {
            return [key, changesGroup[key]];
          }
          if (Object.prototype.hasOwnProperty.call(currentGroup, key)) {
            return [key, currentGroup[key]];
          }
          return [key, fallback[key]];
        }),
      ),
    ]),
  );
};

const publicStudioSettings = (record) => {
  const settings = mergeStudioSettings(record);
  const instagram = normalizeInstagramProfile(settings.contact.instagram);
  return {
    ...settings,
    offer: {
      ...settings.offer,
      // Existing data from an older deployment may contain an enabled offer
      // whose effective saving is zero. Never advertise or redeem that state.
      enabled: Boolean(settings.offer.enabled && welcomeOfferHasValue(settings.offer)),
    },
    contact: {
      ...settings.contact,
      instagramHandle: instagram?.handle ? `@${instagram.handle}` : "",
      instagramUrl: instagram?.url || "",
    },
  };
};

export const getStudioSettings = async (selectedMode) => {
  const mode = selectedMode || (await connectDatabase());
  const record =
    mode === "mongodb"
      ? plain(await StudioSettings.findById("studio"))
      : memoryStore.get("studioSettings", "studio");
  return publicStudioSettings(record || {});
};

export const updateStudioSettings = async (input, updatedBy) => {
  const mode = assertWritable(await connectDatabase());
  const current = await getStudioSettings(mode);
  const settings = mergeStudioSettings(current, input);
  if (settings.offer.enabled && !welcomeOfferHasValue(settings.offer)) {
    const details = [];
    if (Number(settings.offer.percent) <= 0) {
      details.push({
        field: "offer.percent",
        message: "An enabled welcome offer needs a discount above 0%",
      });
    }
    if (Number(settings.offer.maxDiscount) <= 0) {
      details.push({
        field: "offer.maxDiscount",
        message: "An enabled welcome offer needs a maximum saving above ₹0",
      });
    }
    throw badRequest("An enabled welcome offer must provide a real saving", details);
  }
  if (mode === "mongodb") {
    const record = await StudioSettings.findByIdAndUpdate(
      "studio",
      { $set: { ...settings, updatedBy } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    );
    return publicStudioSettings(plain(record));
  }
  const existing = memoryStore.get("studioSettings", "studio");
  const record = existing
    ? memoryStore.update("studioSettings", "studio", { ...settings, updatedBy })
    : memoryStore.create("studioSettings", { ...settings, updatedBy }, "studio");
  return publicStudioSettings(record);
};

const findProductForOrder = async ({ productId, slug }, selectedMode) => {
  const mode = selectedMode || (await ensureCatalogSeeded());
  if (mode === "mongodb") {
    if (mongoose.isValidObjectId(productId)) {
      const product = await Product.findById(productId);
      if (product) return product.active ? plain(product) : undefined;
    }
    return slug ? plain(await Product.findOne({ slug, active: true })) : undefined;
  }
  if (productId) {
    const product = memoryStore.get("products", productId);
    if (product) return product.active ? product : undefined;
  }
  return slug
    ? memoryStore.findOne("products", (product) => product.active && product.slug === slug)
    : undefined;
};

const orderNumber = () => {
  const date = new Date().toISOString().slice(2, 10).replaceAll("-", "");
  // A 48-bit suffix keeps the human-readable daily prefix while making a
  // collision vanishingly unlikely, even at high order volumes.
  return `GNW-${date}-${randomBytes(6).toString("hex").toUpperCase()}`;
};

const hasOrdersForBuyer = async (buyerId, mode) =>
  mode === "mongodb"
    ? Boolean(await Order.exists({ buyerId, status: { $ne: "cancelled" } }))
    : memoryStore.count(
        "orders",
        (order) => order.buyerId === buyerId && order.status !== "cancelled",
      ) > 0;

const releaseCancelledOrderClaims = async (buyerId, mode) => {
  if (mode === "mongodb") {
    await Order.updateMany(
      {
        buyerId,
        status: "cancelled",
        $or: [{ isFirstOrder: true }, { welcomeOfferClaimed: true }],
      },
      { $unset: { isFirstOrder: 1, welcomeOfferClaimed: 1 } },
    );
    return;
  }
  memoryStore
    .find(
      "orders",
      (order) => order.buyerId === buyerId
        && order.status === "cancelled"
        && (order.isFirstOrder || order.welcomeOfferClaimed),
    )
    .forEach((order) => memoryStore.update("orders", order.id, {
      isFirstOrder: undefined,
      welcomeOfferClaimed: undefined,
    }));
};

const findIdempotentOrder = async (buyerId, idempotencyKey, mode) => {
  if (!idempotencyKey) return undefined;
  const record =
    mode === "mongodb"
      ? await Order.findOne({ buyerId, idempotencyKey }).select("+idempotencyKey +idempotencyHash")
      : memoryStore.findOne(
          "orders",
          (order) =>
            order.buyerId === buyerId &&
            order.idempotencyKey === idempotencyKey &&
            order.writePending !== true,
        );
  return plain(record);
};

const persistMongoOrder = async (record, stockRequests, grantReservation) => {
  const session = await mongoose.startSession();
  let createdOrder;
  try {
    await session.withTransaction(
      async () => {
        const inventoryReservations = [];
        const currentProducts = await Product.find({
          _id: { $in: [...stockRequests.keys()] },
          active: true,
        })
          .select("_id name price inventory")
          .session(session);
        const currentById = new Map(
          currentProducts.map((product) => [String(product._id), product]),
        );

        for (const request of stockRequests.values()) {
          const current = currentById.get(request.productId);
          if (!current) {
            throw notFound("One of the selected products", [
              { field: "items", productId: request.productId },
            ]);
          }
          if (current.price !== request.unitPrice) {
            throw conflict(`${request.name}'s price changed. Refresh your bag before ordering`, [
              { field: "items", productId: request.productId, currentPrice: current.price },
            ]);
          }
          if (current.inventory == null) continue;
          const result = await Product.updateOne(
            {
              _id: request.productId,
              active: true,
              price: request.unitPrice,
              inventory: { $gte: request.quantity },
            },
            { $inc: { inventory: -request.quantity } },
            { session },
          );
          if (result.modifiedCount !== 1) {
            throw conflict(`${request.name} does not have enough stock`, [
              { field: "items", productId: request.productId },
            ]);
          }
          inventoryReservations.push({
            productId: request.productId,
            quantity: request.quantity,
          });
        }
        [createdOrder] = await Order.create([{ ...record, inventoryReservations }], { session });
        await consumeOrderCustomizationGrants({
          reservationToken: grantReservation?.reservationToken,
          orderId: createdOrder.id,
          expectedCount: grantReservation?.publicIds.length || 0,
          session,
          mode: "mongodb",
        });
      },
      {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
      },
    );
    if (!createdOrder) {
      throw conflict("The order could not be created. Please retry with the same Idempotency-Key");
    }
    return plain(createdOrder);
  } finally {
    await session.endSession();
  }
};

const reserveMemoryInventory = (stockRequests) => {
  const reservations = [];
  for (const request of stockRequests.values()) {
    const current = memoryStore.get("products", request.productId);
    if (!current || !current.active) {
      throw notFound("One of the selected products", [
        { field: "items", productId: request.productId },
      ]);
    }
    if (current.price !== request.unitPrice) {
      throw conflict(`${request.name}'s price changed. Refresh your bag before ordering`, [
        { field: "items", productId: request.productId, currentPrice: current.price },
      ]);
    }
    if (current.inventory != null && current.inventory < request.quantity) {
      throw conflict(`${request.name} does not have enough stock`, [
        { field: "items", productId: request.productId, available: current?.inventory || 0 },
      ]);
    }
  }
  for (const request of stockRequests.values()) {
    const current = memoryStore.get("products", request.productId);
    if (current.inventory == null) continue;
    memoryStore.update("products", request.productId, {
      inventory: current.inventory - request.quantity,
    });
    reservations.push({ productId: request.productId, quantity: request.quantity });
  }
  return reservations;
};

const duplicateIndex = (error, name, field) =>
  (error?.code === 11000 || error?.code === 11_000) &&
  (error?.keyPattern?.[field] || String(error?.message || "").includes(name));

const hashOrderRequest = (input) =>
  createHash("sha256").update(JSON.stringify(input)).digest("hex");

const assertMatchingReplay = (order, requestHash) => {
  if (order.idempotencyHash && order.idempotencyHash !== requestHash) {
    throw idempotencyKeyReused();
  }
  return order;
};

const waitForIdempotentOrder = async (buyerId, idempotencyKey, requestHash, mode) => {
  if (!idempotencyKey) return undefined;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const repeated = await findIdempotentOrder(buyerId, idempotencyKey, mode);
    if (repeated) return assertMatchingReplay(repeated, requestHash);
    if (attempt < 79) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  return undefined;
};

const reserveOrderGrantsForIdempotentWrite = async ({
  buyerId,
  publicIds,
  idempotencyKey,
  idempotencyHash,
  mode,
}) => {
  try {
    return {
      reservation: await reserveOrderCustomizationGrants({
        userId: buyerId,
        publicIds,
      }),
    };
  } catch (error) {
    if (error?.code !== "CONFLICT" || !idempotencyKey) throw error;
    const repeated = await waitForIdempotentOrder(
      buyerId,
      idempotencyKey,
      idempotencyHash,
      mode,
    );
    if (repeated) return { repeated };
    throw error;
  }
};

export const createOrder = async (buyer, input, { idempotencyKey = "" } = {}) => {
  const mode = assertWritable(await ensureCatalogSeeded());
  const studioSettings = await getStudioSettings(mode);
  const idempotencyHash = idempotencyKey ? hashOrderRequest(input) : "";
  const replay = await findIdempotentOrder(buyer.id, idempotencyKey, mode);
  if (replay) {
    return { order: publicOrder(assertMatchingReplay(replay, idempotencyHash)), replayed: true };
  }

  const items = [];
  const stockRequests = new Map();

  for (const requestedItem of input.items) {
    const product = await findProductForOrder(requestedItem, mode);
    if (!product) {
      throw notFound("One of the selected products", [{
        field: "items",
        productId: requestedItem.productId || "",
        slug: requestedItem.slug || "",
      }]);
    }
    const requestedTotal =
      (stockRequests.get(product.id)?.quantity || 0) + requestedItem.quantity;
    if (product.inventory != null && product.inventory < requestedTotal) {
      throw conflict(`${product.name} does not have enough stock`, [
        { field: "items", productId: product.id, available: product.inventory },
      ]);
    }
    stockRequests.set(product.id, {
      productId: product.id,
      name: product.name,
      unitPrice: product.price,
      quantity: requestedTotal,
    });
    items.push({
      productId: product.id,
      slug: product.slug,
      name: product.name,
      category: product.category,
      image: product.images?.[0]?.url || "",
      unitPrice: product.price,
      quantity: requestedItem.quantity,
      customization: requestedItem.customization,
    });
  }
  const customizationPublicIds = [...new Set(orderCustomizationPublicIds(items))];

  const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const shippingFee =
    subtotal >= studioSettings.shipping.freeThreshold ? 0 : studioSettings.shipping.flatFee;
  let discount = 0;

  if (input.couponCode) {
    if (
      !studioSettings.offer.enabled ||
      input.couponCode !== studioSettings.offer.code ||
      studioSettings.offer.percent <= 0 ||
      studioSettings.offer.maxDiscount <= 0
    ) {
      throw welcomeOfferInvalid();
    }
    const quantityByProduct = items.reduce((totals, item) => {
      totals.set(item.productId, (totals.get(item.productId) || 0) + item.quantity);
      return totals;
    }, new Map());
    const hasCorporateItem = items.some((item) =>
      item.category.trim().toLowerCase().includes("corporate"),
    );
    const hasBulkItem = [...quantityByProduct.values()].some(
      (quantity) => quantity >= studioSettings.shipping.bulkThreshold,
    );
    if (hasCorporateItem || hasBulkItem) {
      throw welcomeOfferExcluded(studioSettings.shipping.bulkThreshold);
    }
    discount = Math.min(
      Math.round((subtotal * studioSettings.offer.percent) / 100),
      studioSettings.offer.maxDiscount,
    );
  }

  const hasPriorOrder = await hasOrdersForBuyer(buyer.id, mode);
  if (!hasPriorOrder) await releaseCancelledOrderClaims(buyer.id, mode);
  if (input.couponCode && hasPriorOrder) {
    throw welcomeOfferIneligible();
  }

  const now = new Date();
  const record = {
    orderNumber: orderNumber(),
    buyerId: buyer.id,
    buyerEmail: buyer.email,
    buyerName: buyer.name,
    items,
    shippingAddress: input.shippingAddress,
    subtotal,
    shippingFee,
    discount,
    total: Math.max(0, subtotal + shippingFee - discount),
    couponCode: input.couponCode,
    welcomeOfferClaimed: Boolean(input.couponCode),
    isFirstOrder: !hasPriorOrder,
    ...(idempotencyKey ? { idempotencyKey, idempotencyHash } : {}),
    note: input.note,
    status: "placed",
    paymentMethod: input.paymentMethod,
    paymentStatus: "pending",
    statusHistory: [{ status: "placed", at: now, note: "Order received" }],
  };

  if (mode === "memory") {
    const repeated = idempotencyKey
      ? memoryStore.findOne(
          "orders",
          (order) =>
            order.buyerId === buyer.id &&
            order.idempotencyKey === idempotencyKey &&
            order.writePending !== true,
        )
      : undefined;
    if (repeated) {
      return {
        order: publicOrder(assertMatchingReplay(repeated, idempotencyHash)),
        replayed: true,
      };
    }
    const firstOrderNow = !memoryStore.findOne(
      "orders",
      (order) => order.buyerId === buyer.id && order.status !== "cancelled",
    );
    if (input.couponCode && !firstOrderNow) {
      throw welcomeOfferIneligible();
    }
    const grantAttempt = await reserveOrderGrantsForIdempotentWrite({
      buyerId: buyer.id,
      publicIds: customizationPublicIds,
      idempotencyKey,
      idempotencyHash,
      mode,
    });
    if (grantAttempt.repeated) {
      return { order: publicOrder(grantAttempt.repeated), replayed: true };
    }
    const grantReservation = grantAttempt.reservation;
    const inventorySnapshots = [...stockRequests.keys()]
      .map((productId) => memoryStore.get("products", productId))
      .filter((product) => product?.inventory != null);
    let createdOrder;
    try {
      const inventoryReservations = reserveMemoryInventory(stockRequests);
      createdOrder = memoryStore.create("orders", {
          ...record,
          isFirstOrder: firstOrderNow,
          inventoryReservations,
          inventoryReleasedAt: null,
          writePending: true,
        });
      await consumeOrderCustomizationGrants({
        reservationToken: grantReservation?.reservationToken,
        orderId: createdOrder.id,
        expectedCount: customizationPublicIds.length,
        mode,
      });
      createdOrder = memoryStore.update("orders", createdOrder.id, { writePending: false });
      return { order: publicOrder(createdOrder), replayed: false };
    } catch (error) {
      if (createdOrder) memoryStore.remove("orders", createdOrder.id);
      inventorySnapshots.forEach((product) => restoreMemoryRecord("products", product));
      await releaseUploadGrantReservation(grantReservation?.reservationToken).catch(() => {});
      throw error;
    }
  }

  const grantAttempt = await reserveOrderGrantsForIdempotentWrite({
    buyerId: buyer.id,
    publicIds: customizationPublicIds,
    idempotencyKey,
    idempotencyHash,
    mode,
  });
  if (grantAttempt.repeated) {
    return { order: publicOrder(grantAttempt.repeated), replayed: true };
  }
  const grantReservation = grantAttempt.reservation;
  try {
    return {
      order: publicOrder(await persistMongoOrder(record, stockRequests, grantReservation)),
      replayed: false,
    };
  } catch (error) {
    const repeated = await findIdempotentOrder(buyer.id, idempotencyKey, mode);
    if (repeated) {
      await releaseUploadGrantReservation(grantReservation?.reservationToken).catch(() => {});
      return {
        order: publicOrder(assertMatchingReplay(repeated, idempotencyHash)),
        replayed: true,
      };
    }

    if (record.isFirstOrder && duplicateIndex(error, "uniq_buyer_first_order", "isFirstOrder")) {
      if (input.couponCode) {
        await releaseUploadGrantReservation(grantReservation?.reservationToken).catch(() => {});
        throw welcomeOfferIneligible();
      }
      try {
        return {
          order: publicOrder(
            await persistMongoOrder(
              { ...record, isFirstOrder: false },
              stockRequests,
              grantReservation,
            ),
          ),
          replayed: false,
        };
      } catch (retryError) {
        await releaseUploadGrantReservation(grantReservation?.reservationToken).catch(() => {});
        throw retryError;
      }
    }
    if (duplicateIndex(error, "uniq_buyer_welcome_offer", "welcomeOfferClaimed")) {
      await releaseUploadGrantReservation(grantReservation?.reservationToken).catch(() => {});
      throw welcomeOfferIneligible();
    }
    await releaseUploadGrantReservation(grantReservation?.reservationToken).catch(() => {});
    throw error;
  }
};

export const listBuyerOrders = async (buyerId, { status, page, limit }) => {
  const mode = await connectDatabase();
  if (mode === "mongodb") {
    const query = { buyerId, ...(status ? { status } : {}) };
    const [records, total] = await Promise.all([
      Order.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Order.countDocuments(query),
    ]);
    return paginate(records.map(publicOrder), page, limit, total);
  }
  const records = memoryStore
    .find("orders", (order) => order.buyerId === buyerId && (!status || order.status === status))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return paginate(slicePage(records, page, limit).map(publicOrder), page, limit, records.length);
};

export const buyerHasOrders = async (buyerId) => {
  const mode = await connectDatabase();
  return hasOrdersForBuyer(buyerId, mode);
};

export const listAllOrders = async ({ status, page, limit }) => {
  const mode = await connectDatabase();
  if (mode === "mongodb") {
    const query = status ? { status } : {};
    const [records, total] = await Promise.all([
      Order.find(query)
        .select("orderNumber buyerName buyerEmail items.name items.quantity status total createdAt")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Order.countDocuments(query),
    ]);
    return paginate(records.map(publicOrder), page, limit, total);
  }
  const records = memoryStore
    .find("orders", (order) => !status || order.status === status)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return paginate(slicePage(records, page, limit).map(publicOrder), page, limit, records.length);
};

export const getOrder = async (id) => {
  const mode = await connectDatabase();
  const record =
    mode === "mongodb"
      ? mongoose.isValidObjectId(id)
        ? await Order.findById(id)
        : await Order.findOne({ orderNumber: id })
      : memoryStore.get("orders", id) ||
        memoryStore.findOne("orders", (order) => order.orderNumber === id);
  if (!record) throw notFound("Order");
  return publicOrder(record);
};

const fulfilmentRank = new Map([
  ["placed", 0],
  ["confirmed", 1],
  ["in_progress", 2],
  ["ready", 3],
  ["shipped", 4],
  ["delivered", 5],
]);

const assertStatusTransition = (from, to) => {
  if (from === to) return;
  if (from === "cancelled" || from === "delivered") {
    throw conflict(`An order marked ${from} cannot move to another status`);
  }
  if (to === "cancelled") {
    if ((fulfilmentRank.get(from) ?? 99) < fulfilmentRank.get("shipped")) return;
    throw conflict("A shipped order cannot be cancelled; complete a manual return instead");
  }
  const fromRank = fulfilmentRank.get(from);
  const toRank = fulfilmentRank.get(to);
  if (fromRank == null || toRank == null || toRank <= fromRank) {
    throw conflict(`Order status cannot move from ${from} to ${to}`);
  }
};

export const updateOrderStatus = async (id, { status, note }, { withMeta = false } = {}) => {
  const mode = assertWritable(await connectDatabase());
  const now = new Date();
  const entry = { status, note, at: now };

  if (mode === "mongodb") {
    const session = await mongoose.startSession();
    let updated;
    let changed = false;
    try {
      await session.withTransaction(
        async () => {
          // Mongoose may retry this callback after a transient transaction error.
          // Recompute the transition flag from the snapshot used by each attempt.
          changed = false;
          const query = mongoose.isValidObjectId(id) ? { _id: id } : { orderNumber: id };
          const order = await Order.findOne(query)
            .select("+inventoryReservations +inventoryReleasedAt")
            .session(session);
          if (!order) throw notFound("Order");
          if (order.status === status) {
            updated = order;
            return;
          }
          assertStatusTransition(order.status, status);
          changed = true;

          if (status === "cancelled" && !order.inventoryReleasedAt) {
            for (const reservation of order.inventoryReservations || []) {
              await Product.updateOne(
                { _id: reservation.productId, inventory: { $type: "number" } },
                { $inc: { inventory: reservation.quantity } },
                { session },
              );
            }
            order.inventoryReleasedAt = now;
          }
          if (status === "cancelled") {
            // A studio-cancelled request must not consume the customer's first-order
            // slot or the welcome-offer partial unique index.
            order.set("isFirstOrder", undefined);
            order.set("welcomeOfferClaimed", undefined);
          }
          order.status = status;
          order.statusHistory.push(entry);
          updated = await order.save({ session });
        },
        {
          readConcern: { level: "snapshot" },
          writeConcern: { w: "majority" },
        },
      );
      const record = publicOrder(updated);
      return withMeta ? { record, changed } : record;
    } finally {
      await session.endSession();
    }
  }

  const existing =
    memoryStore.get("orders", id) ||
    memoryStore.findOne("orders", (order) => order.orderNumber === id);
  if (!existing) throw notFound("Order");
  if (existing.status === status) {
    const record = publicOrder(existing);
    return withMeta ? { record, changed: false } : record;
  }
  assertStatusTransition(existing.status, status);
  let inventoryReleasedAt = existing.inventoryReleasedAt || null;
  if (status === "cancelled" && !inventoryReleasedAt) {
    for (const reservation of existing.inventoryReservations || []) {
      const product = memoryStore.get("products", reservation.productId);
      if (product && typeof product.inventory === "number") {
        memoryStore.update("products", product.id, {
          inventory: product.inventory + reservation.quantity,
        });
      }
    }
    inventoryReleasedAt = now;
  }
  const record = publicOrder(
    memoryStore.update("orders", existing.id, {
      status,
      inventoryReleasedAt,
      ...(status === "cancelled"
        ? { isFirstOrder: undefined, welcomeOfferClaimed: undefined }
        : {}),
      statusHistory: [...existing.statusHistory, entry],
    }),
  );
  return withMeta ? { record, changed: true } : record;
};

export const createCustomInquiry = async (input, user) => {
  if (!user?.id || !user?.email) throw unauthorized();
  const mode = assertWritable(await connectDatabase());
  const parsedReferencePublicIds = input.referenceImages.map(cloudinaryPublicIdFromUrl);
  const invalidReferenceIndex = parsedReferencePublicIds.findIndex((publicId) => !publicId);
  if (invalidReferenceIndex >= 0) {
    throw conflict(
      "Every uploaded reference image must come from this studio's upload service",
      [{ field: "referenceImages", index: invalidReferenceIndex }],
    );
  }
  const referencePublicIds = [...new Set(parsedReferencePublicIds)];
  const reservation = await reserveCustomInquiryGrants({
    userId: user.id,
    publicIds: referencePublicIds,
  });
  const record = {
    ...input,
    userId: user.id,
    email: user.email,
    status: "new",
    adminNote: "",
  };
  if (mode === "mongodb") {
    const session = await mongoose.startSession();
    let created;
    try {
      await session.withTransaction(async () => {
        [created] = await CustomInquiry.create([record], { session });
        await consumeCustomInquiryGrants({
          reservationToken: reservation?.reservationToken,
          inquiryId: created.id,
          expectedCount: referencePublicIds.length,
          session,
          mode,
        });
      });
      return plain(created);
    } catch (error) {
      await releaseUploadGrantReservation(reservation?.reservationToken).catch(() => {});
      throw error;
    } finally {
      await session.endSession();
    }
  }
  let created;
  try {
    created = memoryStore.create("customInquiries", record);
    await consumeCustomInquiryGrants({
      reservationToken: reservation?.reservationToken,
      inquiryId: created.id,
      expectedCount: referencePublicIds.length,
      mode,
    });
    return created;
  } catch (error) {
    if (created) memoryStore.remove("customInquiries", created.id);
    await releaseUploadGrantReservation(reservation?.reservationToken).catch(() => {});
    throw error;
  }
};

export const listBuyerInquiries = async (userId, { page = 1, limit = 20 } = {}) => {
  const mode = await connectDatabase();
  let records;
  let total;
  if (mode === "mongodb") {
    [records, total] = await Promise.all([
      CustomInquiry.find({ userId })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      CustomInquiry.countDocuments({ userId }),
    ]);
  } else {
    const allRecords = memoryStore
      .find("customInquiries", (inquiry) => inquiry.userId === userId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    total = allRecords.length;
    records = slicePage(allRecords, page, limit);
  }
  const items = records.map((record) => {
    const buyerSafe = plain(record);
    delete buyerSafe.adminNote;
    return buyerSafe;
  });
  return paginate(items, page, limit, total);
};

const listInbox = async (collectionName, Model, { status, page, limit }) => {
  const mode = await connectDatabase();
  if (mode === "mongodb") {
    const query = status ? { status } : {};
    const [records, total] = await Promise.all([
      Model.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Model.countDocuments(query),
    ]);
    return paginate(records.map(plain), page, limit, total);
  }
  const records = memoryStore
    .find(collectionName, (record) => !status || record.status === status)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return paginate(slicePage(records, page, limit), page, limit, records.length);
};

const updateInbox = async (collectionName, Model, id, input, resourceName) => {
  const mode = assertWritable(await connectDatabase());
  const changes = Object.entries(input);
  if (mode === "mongodb") {
    if (!mongoose.isValidObjectId(id)) throw notFound(resourceName);
    const record = await Model.findOneAndUpdate(
      {
        _id: id,
        ...(changes.length > 0
          ? { $or: changes.map(([field, value]) => ({ [field]: { $ne: value } })) }
          : {}),
      },
      { $set: input },
      { new: true, runValidators: true },
    );
    if (record) return { record: plain(record), changed: true };
    const existing = await Model.findById(id);
    if (!existing) throw notFound(resourceName);
    return { record: plain(existing), changed: false };
  }
  const existing = memoryStore.get(collectionName, id);
  if (!existing) throw notFound(resourceName);
  const changed = changes.some(([field, value]) => existing[field] !== value);
  if (!changed) return { record: existing, changed: false };
  return { record: memoryStore.update(collectionName, id, input), changed: true };
};

export const listCustomInquiries = (query) =>
  listInbox("customInquiries", CustomInquiry, query);

export const updateCustomInquiry = async (id, input, { withMeta = false } = {}) => {
  const result = await updateInbox("customInquiries", CustomInquiry, id, input, "Custom inquiry");
  return withMeta ? result : result.record;
};

export const createContact = async (input, user) => {
  if (!user?.id || !user?.email) throw unauthorized();
  const mode = assertWritable(await connectDatabase());
  const record = {
    ...input,
    userId: user.id,
    email: user.email,
    phone: input.phone || "",
    status: "new",
    adminNote: "",
  };
  return mode === "mongodb" ? plain(await Contact.create(record)) : memoryStore.create("contacts", record);
};

export const listContacts = (query) => listInbox("contacts", Contact, query);

export const updateContact = async (id, input, { withMeta = false } = {}) => {
  const result = await updateInbox("contacts", Contact, id, input, "Contact message");
  return withMeta ? result : result.record;
};

const adminUserView = (record, relationship = {}) => {
  const user = plain(record);
  if (!user) return user;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatar: user.avatar || "",
    role: user.role,
    emailVerified: Boolean(user.emailVerifiedAt || user.googleSub),
    providers:
      user.providers?.length > 0
        ? normalizedProviders(user.providers)
        : user.googleSub
          ? ["google"]
          : [],
    phone: maskPhone(user.phone),
    phoneVerified: Boolean(user.phoneVerifiedAt),
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    ordersCount: relationship.ordersCount || 0,
    totalSpent: relationship.totalSpent || 0,
    customRequestsCount: relationship.customRequestsCount || 0,
  };
};

export const listRegisteredUsers = async ({ search, role, phoneVerified, page, limit }) => {
  const mode = await connectDatabase();
  if (mode === "mongodb") {
    const query = {};
    if (role) query.role = role;
    if (phoneVerified === true) query.phoneVerifiedAt = { $ne: null };
    if (phoneVerified === false) {
      query.$or = [{ phoneVerifiedAt: null }, { phoneVerifiedAt: { $exists: false } }];
    }
    if (search) {
      const pattern = new RegExp(escapeRegExp(search), "i");
      const searchFields = [{ name: pattern }, { email: pattern }, { phone: pattern }];
      if (query.$or) query.$and = [{ $or: query.$or }, { $or: searchFields }];
      else query.$or = searchFields;
    }
    const [records, total] = await Promise.all([
      User.find(query)
        .select("email name avatar role emailVerifiedAt googleSub providers phone phoneVerifiedAt createdAt lastLoginAt")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      User.countDocuments(query),
    ]);
    const userIds = records.map((record) => String(record._id));
    const [orderMetrics, inquiryMetrics] = userIds.length
      ? await Promise.all([
          Order.aggregate([
            { $match: { buyerId: { $in: userIds }, status: { $ne: "cancelled" } } },
            {
              $group: {
                _id: "$buyerId",
                ordersCount: { $sum: 1 },
                totalSpent: { $sum: "$total" },
              },
            },
          ]),
          CustomInquiry.aggregate([
            { $match: { userId: { $in: userIds } } },
            { $group: { _id: "$userId", customRequestsCount: { $sum: 1 } } },
          ]),
        ])
      : [[], []];
    const relationships = new Map(
      orderMetrics.map((item) => [String(item._id), { ...item }]),
    );
    inquiryMetrics.forEach((item) => {
      relationships.set(String(item._id), {
        ...(relationships.get(String(item._id)) || {}),
        customRequestsCount: item.customRequestsCount,
      });
    });
    return paginate(
      records.map((record) => adminUserView(record, relationships.get(String(record._id)))),
      page,
      limit,
      total,
    );
  }

  const needle = search?.toLowerCase();
  const records = memoryStore
    .all("users")
    .filter((user) => !role || user.role === role)
    .filter(
      (user) => phoneVerified === undefined || Boolean(user.phoneVerifiedAt) === phoneVerified,
    )
    .filter(
      (user) =>
        !needle ||
        [user.name, user.email, user.phone].filter(Boolean).join(" ").toLowerCase().includes(needle),
    )
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return paginate(
    slicePage(records, page, limit).map((user) => {
      const orders = memoryStore.find(
        "orders",
        (order) => order.buyerId === user.id && order.status !== "cancelled",
      );
      return adminUserView(user, {
        ordersCount: orders.length,
        totalSpent: orders.reduce((total, order) => total + order.total, 0),
        customRequestsCount: memoryStore.count(
          "customInquiries",
          (inquiry) => inquiry.userId === user.id,
        ),
      });
    }),
    page,
    limit,
    records.length,
  );
};

export const getRegisteredUserMetrics = async (
  selectedMode,
  { includeRepeatCustomers = true } = {},
) => {
  const mode = selectedMode || (await connectDatabase());
  const now = new Date();
  const monthStartedAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000);
  if (mode === "mongodb") {
    const [userMetricRows, repeatCustomerRows] = await Promise.all([
      User.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            buyers: { $sum: { $cond: [{ $eq: ["$role", "buyer"] }, 1, 0] } },
            admins: { $sum: { $cond: [{ $eq: ["$role", "admin"] }, 1, 0] } },
            phoneVerified: {
              $sum: {
                $cond: [
                  { $ne: [{ $ifNull: ["$phoneVerifiedAt", null] }, null] },
                  1,
                  0,
                ],
              },
            },
            signupsLast7Days: {
              $sum: { $cond: [{ $gte: ["$createdAt", sevenDaysAgo] }, 1, 0] },
            },
            signupsLast30Days: {
              $sum: { $cond: [{ $gte: ["$createdAt", thirtyDaysAgo] }, 1, 0] },
            },
            newThisMonth: {
              $sum: { $cond: [{ $gte: ["$createdAt", monthStartedAt] }, 1, 0] },
            },
          },
        },
      ]),
      includeRepeatCustomers
        ? Order.aggregate([
            { $match: { status: { $ne: "cancelled" } } },
            { $group: { _id: "$buyerId", ordersCount: { $sum: 1 } } },
            { $match: { ordersCount: { $gte: 2 } } },
            { $count: "total" },
          ])
        : Promise.resolve([]),
    ]);
    const userMetrics = userMetricRows[0] || {};
    return {
      total: userMetrics.total || 0,
      buyers: userMetrics.buyers || 0,
      admins: userMetrics.admins || 0,
      phoneVerified: userMetrics.phoneVerified || 0,
      signupsLast7Days: userMetrics.signupsLast7Days || 0,
      signupsLast30Days: userMetrics.signupsLast30Days || 0,
      newThisMonth: userMetrics.newThisMonth || 0,
      repeatCustomers: repeatCustomerRows[0]?.total || 0,
    };
  }
  const users = memoryStore.all("users");
  return {
    total: users.length,
    buyers: users.filter((user) => user.role === "buyer").length,
    admins: users.filter((user) => user.role === "admin").length,
    phoneVerified: users.filter((user) => user.phoneVerifiedAt).length,
    signupsLast7Days: users.filter((user) => new Date(user.createdAt) >= sevenDaysAgo).length,
    signupsLast30Days: users.filter((user) => new Date(user.createdAt) >= thirtyDaysAgo).length,
    newThisMonth: users.filter((user) => new Date(user.createdAt) >= monthStartedAt).length,
    repeatCustomers: includeRepeatCustomers
      ? users.filter(
          (user) =>
            memoryStore.count(
              "orders",
              (order) => order.buyerId === user.id && order.status !== "cancelled",
            ) >= 2,
        ).length
      : 0,
  };
};

export const getRegisteredUserDetail = async (id) => {
  const mode = await connectDatabase();
  const record =
    mode === "mongodb"
      ? mongoose.isValidObjectId(id)
        ? await User.findById(id)
        : undefined
      : memoryStore.get("users", id);
  if (!record) throw notFound("User");

  if (mode === "mongodb") {
    const [orderMetrics = { totalOrders: 0, lifetimeValue: 0 }, inquiryCount, recentOrders] =
      await Promise.all([
        Order.aggregate([
          { $match: { buyerId: id, status: { $ne: "cancelled" } } },
          {
            $group: {
              _id: null,
              totalOrders: { $sum: 1 },
              lifetimeValue: { $sum: "$total" },
            },
          },
        ]).then((records) => records[0]),
        CustomInquiry.countDocuments({ userId: id }),
        Order.find({ buyerId: id }).sort({ createdAt: -1 }).limit(5),
      ]);
    return {
      ...adminUserView(record),
      metrics: {
        totalOrders: orderMetrics.totalOrders || 0,
        lifetimeValue: orderMetrics.lifetimeValue || 0,
        customInquiries: inquiryCount,
      },
      recentOrders: recentOrders.map(publicOrder),
    };
  }

  const orders = memoryStore
    .find("orders", (order) => order.buyerId === id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const billableOrders = orders.filter((order) => order.status !== "cancelled");
  return {
    ...adminUserView(record),
    metrics: {
      totalOrders: billableOrders.length,
      lifetimeValue: billableOrders.reduce((total, order) => total + order.total, 0),
      customInquiries: memoryStore.count(
        "customInquiries",
        (inquiry) => inquiry.userId === id,
      ),
    },
    recentOrders: orders.slice(0, 5).map(publicOrder),
  };
};

export const getDashboardStats = async () => {
  const mode = await ensureCatalogSeeded();
  const pendingOrderStatuses = ["placed", "confirmed", "in_progress", "ready", "shipped"];
  if (mode === "mongodb") {
    const [
      products,
      orders,
      ordersPending,
      newInquiries,
      newMessages,
      userMetrics,
      recentOrders,
      lowStock,
    ] = await Promise.all([
      Product.countDocuments({ active: true }),
      Order.countDocuments({}),
      Order.countDocuments({ status: { $in: pendingOrderStatuses } }),
      CustomInquiry.countDocuments({ status: "new" }),
      Contact.countDocuments({ status: "new" }),
      getRegisteredUserMetrics(mode, { includeRepeatCustomers: false }),
      Order.find({ status: { $in: pendingOrderStatuses } })
        .select("orderNumber buyerName buyerEmail items.name status total createdAt")
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
      Product.find({
        active: true,
        archivedAt: null,
        inventory: { $gte: 0, $lte: 3 },
      })
        .select("slug name category price compareAtPrice images inventory active archivedAt")
        .sort({ inventory: 1, createdAt: -1 })
        .limit(4)
        .lean(),
    ]);
    return {
      products,
      orders,
      ordersPending,
      newInquiries,
      newMessages,
      users: userMetrics.total,
      registeredUsers: userMetrics.buyers,
      verifiedPhoneUsers: userMetrics.phoneVerified,
      signupsLast30Days: userMetrics.signupsLast30Days,
      newUsersThisMonth: userMetrics.newThisMonth,
      recentOrders: recentOrders.map(publicOrder),
      lowStock: lowStock.map(plain),
    };
  }
  const userMetrics = await getRegisteredUserMetrics(mode, { includeRepeatCustomers: false });
  const recentOrders = memoryStore
    .find("orders", (order) => pendingOrderStatuses.includes(order.status))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 5)
    .map(publicOrder);
  const lowStock = memoryStore
    .find(
      "products",
      (product) => product.active
        && !product.archivedAt
        && product.inventory != null
        && Number.isFinite(Number(product.inventory))
        && Number(product.inventory) <= 3,
    )
    .sort(
      (a, b) => Number(a.inventory) - Number(b.inventory)
        || new Date(b.createdAt) - new Date(a.createdAt),
    )
    .slice(0, 4)
    .map(plain);
  return {
    products: memoryStore.count("products", (product) => product.active),
    orders: memoryStore.count("orders"),
    ordersPending: memoryStore.count(
      "orders",
      (order) => pendingOrderStatuses.includes(order.status),
    ),
    newInquiries: memoryStore.count("customInquiries", (inquiry) => inquiry.status === "new"),
    newMessages: memoryStore.count("contacts", (contact) => contact.status === "new"),
    users: userMetrics.total,
    registeredUsers: userMetrics.buyers,
    verifiedPhoneUsers: userMetrics.phoneVerified,
    signupsLast30Days: userMetrics.signupsLast30Days,
    newUsersThisMonth: userMetrics.newThisMonth,
    recentOrders,
    lowStock,
  };
};

const uploadGrantLifetimeSeconds = (purpose) =>
  purpose === "orders" ? 7 * 24 * 60 * 60 : 2 * 60 * 60;

export const reserveUploadGrant = async ({ userId, purpose, publicId }) => {
  const mode = assertWritable(await connectDatabase());
  const now = Date.now();
  const expiresInSeconds = uploadGrantLifetimeSeconds(purpose);
  const grantExpiresAt = new Date(now + expiresInSeconds * 1_000);
  const windowStartedAt = new Date(Math.floor(now / 3_600_000) * 3_600_000);
  const expiresAt = new Date(windowStartedAt.getTime() + 2 * 3_600_000);
  const quotaId = `${userId}:${windowStartedAt.toISOString()}`;

  if (mode === "mongodb") {
    try {
      await UploadQuota.findOneAndUpdate(
        { _id: quotaId, count: { $lt: env.uploadSignaturesPerHour } },
        {
          $inc: { count: 1 },
          $setOnInsert: { userId, windowStartedAt, expiresAt },
        },
        { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
      );
    } catch (error) {
      if (error?.code === 11000 || error?.code === 11_000) {
        const racedQuota = await UploadQuota.findOneAndUpdate(
          { _id: quotaId, count: { $lt: env.uploadSignaturesPerHour } },
          { $inc: { count: 1 } },
          { new: true, runValidators: true },
        );
        if (!racedQuota) {
          throw rateLimited("Your hourly upload limit has been reached. Please try again later");
        }
      } else {
        throw error;
      }
    }
    const grant = await UploadGrant.create({
      publicId,
      userId,
      purpose,
      verificationRequired: true,
      expiresAt: grantExpiresAt,
    });
    return { ...plain(grant), expiresInSeconds };
  }

  const existing = memoryStore.get("uploadQuotas", quotaId);
  if (existing && existing.count >= env.uploadSignaturesPerHour) {
    throw rateLimited("Your hourly upload limit has been reached. Please try again later");
  }
  if (existing) {
    memoryStore.update("uploadQuotas", quotaId, { count: existing.count + 1 });
  } else {
    memoryStore.create(
      "uploadQuotas",
      { userId, count: 1, windowStartedAt, expiresAt },
      quotaId,
    );
  }
  const grant = memoryStore.create(
    "uploadGrants",
    {
      publicId,
      userId,
      purpose,
      verificationRequired: true,
      reservationToken: "",
      productId: "",
      orderId: "",
      expiresAt: grantExpiresAt,
    },
    publicId,
  );
  return { ...grant, expiresInSeconds };
};

const unreservedGrantQuery = {
  consumedAt: { $exists: false },
  $or: [{ reservationToken: "" }, { reservationToken: { $exists: false } }],
};

const uploadVerificationReservationStaleMs = 2 * 60 * 1_000;

const assertUploadGrantCanBeVerified = (grant, { allowProductUploads, now }) => {
  if (!grant) throw notFound("Upload grant");
  if (grant.purpose === "products" && !allowProductUploads) {
    throw forbidden("Only an administrator can verify product images");
  }
  if (grant.deletedAt) throw conflict("This uploaded image has already been removed");
  if (grant.consumedAt) throw conflict("This upload grant has already been used");
  if (!grant.expiresAt || new Date(grant.expiresAt).getTime() <= now.getTime()) {
    throw conflict("This upload grant has expired");
  }
};

export const claimUploadGrantForVerification = async ({
  userId,
  publicId,
  allowProductUploads = false,
}) => {
  const mode = assertWritable(await connectDatabase());
  const now = new Date();
  const reservationToken = randomBytes(24).toString("base64url");
  const existing =
    mode === "mongodb"
      ? plain(await UploadGrant.findOne({ publicId, userId }))
      : memoryStore.findOne(
          "uploadGrants",
          (grant) => grant.publicId === publicId && grant.userId === userId,
        );

  assertUploadGrantCanBeVerified(existing, { allowProductUploads, now });
  if (existing.verifiedAt) {
    if (existing.reservationToken) {
      throw conflict("This upload is currently being removed. Please try again");
    }
    return { grant: existing, reservationToken: "", alreadyVerified: true };
  }

  let claimed;
  const staleBefore = new Date(now.getTime() - uploadVerificationReservationStaleMs);
  if (mode === "mongodb") {
    claimed = plain(
      await UploadGrant.findOneAndUpdate(
        {
          publicId,
          userId,
          expiresAt: { $gt: now },
          verifiedAt: { $exists: false },
          deletedAt: { $exists: false },
          consumedAt: { $exists: false },
          $or: [
            { reservationToken: "" },
            { reservationToken: { $exists: false } },
            {
              reservationKind: "verification",
              reservedAt: { $lte: staleBefore },
            },
          ],
        },
        {
          $set: {
            reservationToken,
            reservedAt: now,
            reservationKind: "verification",
          },
        },
        { new: true, runValidators: true },
      ),
    );
  } else {
    const candidate = memoryStore.get("uploadGrants", publicId);
    if (
      candidate &&
      candidate.userId === userId &&
      !candidate.verifiedAt &&
      !candidate.deletedAt &&
      !candidate.consumedAt &&
      (!candidate.reservationToken ||
        (candidate.reservationKind === "verification" &&
          candidate.reservedAt &&
          new Date(candidate.reservedAt).getTime() <= staleBefore.getTime())) &&
      new Date(candidate.expiresAt).getTime() > now.getTime()
    ) {
      claimed = memoryStore.update("uploadGrants", candidate.id, {
        reservationToken,
        reservedAt: now,
        reservationKind: "verification",
      });
    }
  }

  if (claimed) return { grant: claimed, reservationToken, alreadyVerified: false };

  // A concurrent completion may have won after the first read. Re-read so that
  // retries are idempotent instead of reporting a false conflict.
  const current =
    mode === "mongodb"
      ? plain(await UploadGrant.findOne({ publicId, userId }))
      : memoryStore.findOne(
          "uploadGrants",
          (grant) => grant.publicId === publicId && grant.userId === userId,
        );
  assertUploadGrantCanBeVerified(current, {
    allowProductUploads,
    now: new Date(),
  });
  if (current.verifiedAt) {
    if (current.reservationToken) {
      throw conflict("This upload is currently being removed. Please try again");
    }
    return { grant: current, reservationToken: "", alreadyVerified: true };
  }
  throw conflict("This upload is currently being verified. Please try again");
};

export const finalizeUploadGrantVerification = async ({
  userId,
  publicId,
  reservationToken,
  bytes,
  width,
  height,
  format,
  version,
  assetId,
  secureUrl,
}) => {
  const mode = assertWritable(await connectDatabase());
  const verifiedAt = new Date();
  const verifiedFields = {
    verifiedAt,
    verifiedBytes: bytes,
    verifiedWidth: width,
    verifiedHeight: height,
    verifiedFormat: format,
    verifiedVersion: version,
    verifiedAssetId: assetId || "",
    verifiedSecureUrl: secureUrl,
    reservationToken: "",
  };

  if (mode === "mongodb") {
    const grant = await UploadGrant.findOneAndUpdate(
      {
        publicId,
        userId,
        reservationToken,
        reservationKind: "verification",
        consumedAt: { $exists: false },
        deletedAt: { $exists: false },
        verifiedAt: { $exists: false },
        expiresAt: { $gt: verifiedAt },
      },
      {
        $set: verifiedFields,
        $unset: { reservedAt: 1, reservationKind: 1 },
      },
      { new: true, runValidators: true },
    );
    if (!grant) throw conflict("The upload could not be verified. Please try again");
    return plain(grant);
  }

  const grant = memoryStore.get("uploadGrants", publicId);
  if (
    !grant ||
    grant.userId !== userId ||
    grant.reservationToken !== reservationToken ||
    grant.reservationKind !== "verification" ||
    grant.consumedAt ||
    grant.deletedAt ||
    grant.verifiedAt ||
    new Date(grant.expiresAt).getTime() <= verifiedAt.getTime()
  ) {
    throw conflict("The upload could not be verified. Please try again");
  }
  return memoryStore.update("uploadGrants", grant.id, {
    ...verifiedFields,
    reservedAt: null,
    reservationKind: undefined,
  });
};

export const rejectUploadGrantVerification = async ({
  userId,
  publicId,
  reservationToken,
}) => {
  const mode = assertWritable(await connectDatabase());
  if (mode === "mongodb") {
    const result = await UploadGrant.deleteOne({
      publicId,
      userId,
      reservationToken,
      reservationKind: "verification",
      consumedAt: { $exists: false },
      verifiedAt: { $exists: false },
    });
    if (result.deletedCount !== 1) {
      throw conflict("The rejected upload could not be finalized");
    }
    return true;
  }

  const grant = memoryStore.get("uploadGrants", publicId);
  if (
    !grant ||
    grant.userId !== userId ||
    grant.reservationToken !== reservationToken ||
    grant.reservationKind !== "verification" ||
    grant.consumedAt ||
    grant.verifiedAt
  ) {
    throw conflict("The rejected upload could not be finalized");
  }
  memoryStore.remove("uploadGrants", grant.id);
  return true;
};

export const releaseUploadGrantReservation = async (reservationToken) => {
  if (!reservationToken) return;
  const mode = assertWritable(await connectDatabase());
  if (mode === "mongodb") {
    await UploadGrant.updateMany(
      {
        reservationToken,
        $or: [{ consumedAt: { $exists: false } }, { reservationKind: "cleanup" }],
      },
      {
        $set: { reservationToken: "" },
        $unset: { reservedAt: 1, reservationKind: 1 },
      },
    );
    return;
  }
  memoryStore
    .find(
      "uploadGrants",
      (grant) =>
        grant.reservationToken === reservationToken &&
        (!grant.consumedAt || grant.reservationKind === "cleanup"),
    )
    .forEach((grant) =>
      memoryStore.update("uploadGrants", grant.id, {
        reservationToken: "",
        reservedAt: null,
        reservationKind: undefined,
      }),
    );
};

export const claimUnconsumedUploadGrantsForCleanup = async ({ userId }) => {
  const mode = assertWritable(await connectDatabase());
  const reservationToken = randomBytes(24).toString("base64url");
  const now = new Date();

  if (mode === "mongodb") {
    await UploadGrant.updateMany(
      {
        userId,
        consumedAt: { $exists: false },
        deletedAt: { $exists: false },
        $or: [{ reservationToken: "" }, { reservationToken: { $exists: false } }],
      },
      {
        $set: {
          reservationToken,
          reservedAt: now,
          reservationKind: "cleanup",
        },
      },
    );
    const grants = await UploadGrant.find({
      userId,
      reservationToken,
      reservationKind: "cleanup",
      consumedAt: { $exists: false },
    });
    return {
      reservationToken: grants.length ? reservationToken : "",
      grants: grants.map(plain),
    };
  }

  const grants = memoryStore
    .find(
      "uploadGrants",
      (grant) =>
        grant.userId === userId &&
        !grant.consumedAt &&
        !grant.deletedAt &&
        !grant.reservationToken,
    )
    .map((grant) =>
      memoryStore.update("uploadGrants", grant.id, {
        reservationToken,
        reservedAt: now,
        reservationKind: "cleanup",
      }),
    );
  return {
    reservationToken: grants.length ? reservationToken : "",
    grants,
  };
};

const expiredCleanupReservationIsAvailable = (grant, staleBefore) => {
  if (!grant.reservationToken) return true;
  const reservationTimestamp = grant.reservedAt || grant.updatedAt;
  return Boolean(
    reservationTimestamp && new Date(reservationTimestamp).getTime() <= staleBefore.getTime(),
  );
};

export const claimNextExpiredUploadGrantForCleanup = async ({
  now = new Date(),
  reservationStaleMs = 15 * 60 * 1_000,
} = {}) => {
  const mode = assertWritable(await connectDatabase());
  const claimedAt = new Date(now);
  const staleBefore = new Date(claimedAt.getTime() - reservationStaleMs);
  const reservationToken = randomBytes(24).toString("base64url");

  if (mode === "mongodb") {
    const grant = await UploadGrant.findOneAndUpdate(
      {
        consumedAt: { $exists: false },
        deletedAt: { $exists: false },
        expiresAt: { $lte: claimedAt },
        $and: [
          {
            $or: [
              { cleanupNotBefore: { $exists: false } },
              { cleanupNotBefore: null },
              { cleanupNotBefore: { $lte: claimedAt } },
            ],
          },
          {
            $or: [
              { reservationToken: "" },
              { reservationToken: { $exists: false } },
              { reservedAt: { $lte: staleBefore } },
              {
                $and: [
                  { reservedAt: { $exists: false } },
                  { updatedAt: { $lte: staleBefore } },
                ],
              },
            ],
          },
        ],
      },
      {
        $set: {
          reservationToken,
          reservedAt: claimedAt,
          reservationKind: "expired-cleanup",
          lastCleanupAttemptAt: claimedAt,
        },
        $inc: { cleanupAttempts: 1 },
        $unset: { cleanupNotBefore: 1 },
      },
      { new: true, runValidators: true, sort: { expiresAt: 1, createdAt: 1 } },
    );
    return plain(grant);
  }

  const grant = memoryStore
    .find(
      "uploadGrants",
      (candidate) =>
        !candidate.consumedAt &&
        !candidate.deletedAt &&
        candidate.expiresAt &&
        new Date(candidate.expiresAt).getTime() <= claimedAt.getTime() &&
        (!candidate.cleanupNotBefore ||
          new Date(candidate.cleanupNotBefore).getTime() <= claimedAt.getTime()) &&
        expiredCleanupReservationIsAvailable(candidate, staleBefore),
    )
    .sort(
      (left, right) =>
        new Date(left.expiresAt).getTime() - new Date(right.expiresAt).getTime() ||
        new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
    )[0];
  if (!grant) return undefined;
  return memoryStore.update("uploadGrants", grant.id, {
    reservationToken,
    reservedAt: claimedAt,
    reservationKind: "expired-cleanup",
    cleanupAttempts: (grant.cleanupAttempts || 0) + 1,
    lastCleanupAttemptAt: claimedAt,
    cleanupNotBefore: undefined,
  });
};

export const finalizeExpiredUploadGrantCleanup = async ({
  publicId,
  reservationToken,
}) => {
  const mode = assertWritable(await connectDatabase());
  if (mode === "mongodb") {
    const result = await UploadGrant.deleteOne({
      publicId,
      reservationToken,
      reservationKind: "expired-cleanup",
      consumedAt: { $exists: false },
      deletedAt: { $exists: false },
    });
    return result.deletedCount === 1;
  }

  const grant = memoryStore.get("uploadGrants", publicId);
  if (
    !grant ||
    grant.reservationToken !== reservationToken ||
    grant.reservationKind !== "expired-cleanup" ||
    grant.consumedAt ||
    grant.deletedAt
  ) {
    return false;
  }
  memoryStore.remove("uploadGrants", grant.id);
  return true;
};

export const releaseExpiredUploadGrantCleanup = async ({
  publicId,
  reservationToken,
  retryAt,
}) => {
  const mode = assertWritable(await connectDatabase());
  const cleanupNotBefore = new Date(retryAt);
  if (mode === "mongodb") {
    const result = await UploadGrant.updateOne(
      {
        publicId,
        reservationToken,
        reservationKind: "expired-cleanup",
        consumedAt: { $exists: false },
        deletedAt: { $exists: false },
      },
      {
        $set: { reservationToken: "", cleanupNotBefore },
        $unset: { reservedAt: 1, reservationKind: 1 },
      },
    );
    return result.modifiedCount === 1;
  }

  const grant = memoryStore.get("uploadGrants", publicId);
  if (
    !grant ||
    grant.reservationToken !== reservationToken ||
    grant.reservationKind !== "expired-cleanup" ||
    grant.consumedAt ||
    grant.deletedAt
  ) {
    return false;
  }
  memoryStore.update("uploadGrants", grant.id, {
    reservationToken: "",
    reservedAt: null,
    reservationKind: undefined,
    cleanupNotBefore,
  });
  return true;
};

const uploadGrantUuidPattern =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

const reserveUploadGrantsForWrite = async ({
  userId,
  publicIds = [],
  purpose,
  reservationKind,
  field,
  message,
}) => {
  const uniquePublicIds = [...new Set(publicIds)];
  if (!uniquePublicIds.length) return undefined;
  const mode = assertWritable(await connectDatabase());
  const reservationToken = randomBytes(24).toString("base64url");
  const now = new Date();
  const claimed = [];

  try {
    for (const publicId of uniquePublicIds) {
      const expectedPublicId = new RegExp(
        `^gift-n-wrap/${escapeRegExp(purpose)}/${escapeRegExp(String(userId))}/${uploadGrantUuidPattern}$`,
      );
      if (!expectedPublicId.test(publicId)) {
        throw conflict(message, [{ field, publicId }]);
      }
      let grant;
      if (mode === "mongodb") {
        grant = plain(
          await UploadGrant.findOneAndUpdate(
            {
              publicId,
              userId,
              purpose,
              expiresAt: { $gt: now },
              $and: [
                {
                  $or: [
                    { verificationRequired: { $ne: true } },
                    { verificationRequired: true, verifiedAt: { $type: "date" } },
                  ],
                },
              ],
              ...unreservedGrantQuery,
            },
            {
              $set: {
                reservationToken,
                reservedAt: now,
                reservationKind,
              },
            },
            { new: true, runValidators: true },
          ),
        );
      } else {
        const candidate = memoryStore.get("uploadGrants", publicId);
        if (
          candidate &&
          candidate.userId === userId &&
          candidate.purpose === purpose &&
          candidate.expiresAt > now &&
          (candidate.verificationRequired !== true || candidate.verifiedAt instanceof Date) &&
          !candidate.consumedAt &&
          !candidate.reservationToken
        ) {
          grant = memoryStore.update("uploadGrants", candidate.id, {
            reservationToken,
            reservedAt: now,
            reservationKind,
          });
        }
      }
      if (!grant) {
        if (uploadGrantReservationConflictHookForTests) {
          await uploadGrantReservationConflictHookForTests({
            publicId,
            purpose,
            reservationKind,
          });
        }
        throw conflict(message, [{ field, publicId }]);
      }
      claimed.push(publicId);
    }
    return { reservationToken, publicIds: claimed };
  } catch (error) {
    await releaseUploadGrantReservation(reservationToken).catch(() => {});
    throw error;
  }
};

export const reserveProductImageGrants = async ({ userId, publicIds = [] }) =>
  reserveUploadGrantsForWrite({
    userId,
    publicIds,
    purpose: "products",
    reservationKind: "product-write",
    field: "images",
    message:
      "Every new uploaded product image requires an unused grant owned by this administrator",
  });

const reserveOrderCustomizationGrants = async ({ userId, publicIds = [] }) =>
  reserveUploadGrantsForWrite({
    userId,
    publicIds,
    purpose: "orders",
    reservationKind: "order-write",
    field: "items.customization",
    message: "Every customization image requires an unused upload grant owned by this customer",
  });

const reserveCustomInquiryGrants = async ({ userId, publicIds = [] }) =>
  reserveUploadGrantsForWrite({
    userId,
    publicIds,
    purpose: "custom-inquiries",
    reservationKind: "inquiry-write",
    field: "referenceImages",
    message: "Every reference image requires an unused upload grant owned by this customer",
  });

const consumeReservedUploadGrants = async ({
  reservationToken,
  reservationKind,
  attachmentField,
  attachmentId,
  expectedCount = 0,
  session,
  mode: selectedMode,
  failureMessage,
}) => {
  if (!expectedCount) return;
  if (!reservationToken) {
    throw conflict(failureMessage);
  }
  if (uploadGrantConsumptionHookForTests) {
    await uploadGrantConsumptionHookForTests({
      reservationToken,
      reservationKind,
      attachmentId: String(attachmentId),
      expectedCount,
    });
  }
  const mode = assertWritable(selectedMode || (await connectDatabase()));
  const now = new Date();
  if (mode === "mongodb") {
    const result = await UploadGrant.updateMany(
      {
        reservationToken,
        reservationKind,
        consumedAt: { $exists: false },
      },
      {
        $set: {
          consumedAt: now,
          [attachmentField]: String(attachmentId),
          reservationToken: "",
        },
        $unset: { reservedAt: 1, reservationKind: 1, expiresAt: 1 },
      },
      { session },
    );
    if (result.modifiedCount !== expectedCount) {
      throw conflict(failureMessage);
    }
    return;
  }
  const grants = memoryStore.find(
    "uploadGrants",
    (grant) =>
      grant.reservationToken === reservationToken &&
      grant.reservationKind === reservationKind &&
      !grant.consumedAt,
  );
  if (grants.length !== expectedCount) {
    throw conflict(failureMessage);
  }
  grants.forEach((grant) =>
    memoryStore.update("uploadGrants", grant.id, {
      consumedAt: now,
      [attachmentField]: String(attachmentId),
      reservationToken: "",
      reservedAt: null,
      reservationKind: undefined,
      expiresAt: undefined,
    }),
  );
};

export const consumeProductImageGrants = async ({
  reservationToken,
  productId,
  expectedCount = 0,
  session,
  mode,
}) =>
  consumeReservedUploadGrants({
    reservationToken,
    reservationKind: "product-write",
    attachmentField: "productId",
    attachmentId: productId,
    expectedCount,
    session,
    mode,
    failureMessage: "Product image grants could not be finalized",
  });

const consumeOrderCustomizationGrants = async ({
  reservationToken,
  orderId,
  expectedCount = 0,
  session,
  mode,
}) =>
  consumeReservedUploadGrants({
    reservationToken,
    reservationKind: "order-write",
    attachmentField: "orderId",
    attachmentId: orderId,
    expectedCount,
    session,
    mode,
    failureMessage: "Order customization image grants could not be finalized",
  });

const consumeCustomInquiryGrants = async ({
  reservationToken,
  inquiryId,
  expectedCount = 0,
  session,
  mode,
}) =>
  consumeReservedUploadGrants({
    reservationToken,
    reservationKind: "inquiry-write",
    attachmentField: "inquiryId",
    attachmentId: inquiryId,
    expectedCount,
    session,
    mode,
    failureMessage: "Custom inquiry reference image grants could not be finalized",
  });

const productReferencesPublicId = async (publicId, mode) =>
  mode === "mongodb"
    ? Boolean(await Product.exists({ "images.publicId": publicId }))
    : Boolean(
        memoryStore.findOne("products", (product) =>
          product.images?.some((image) => image.publicId === publicId),
        ),
      );

export const claimUploadGrantForCleanup = async ({
  userId,
  publicId,
  allowConsumedProductCleanup = false,
}) => {
  const mode = assertWritable(await connectDatabase());
  const reservationToken = randomBytes(24).toString("base64url");
  const now = new Date();
  let grant;
  if (mode === "mongodb") {
    grant = plain(
      await UploadGrant.findOneAndUpdate(
        {
          publicId,
          userId,
          expiresAt: { $gt: now },
          ...unreservedGrantQuery,
        },
        {
          $set: {
            reservationToken,
            reservedAt: now,
            reservationKind: "cleanup",
          },
        },
        { new: true, runValidators: true },
      ),
    );
  } else {
    const candidate = memoryStore.get("uploadGrants", publicId);
    if (
      candidate &&
      candidate.userId === userId &&
      candidate.expiresAt > now &&
      !candidate.consumedAt &&
      !candidate.reservationToken
    ) {
      grant = memoryStore.update("uploadGrants", candidate.id, {
        reservationToken,
        reservedAt: now,
        reservationKind: "cleanup",
      });
    }
  }
  if (grant) return { ...grant, provenanceRetained: false };

  const existing =
    mode === "mongodb"
      ? plain(await UploadGrant.findOne({ publicId }))
      : memoryStore.get("uploadGrants", publicId);
  if (!existing) throw notFound("Upload grant");
  if (existing.userId !== userId) {
    throw forbidden("Only the upload owner can remove this image");
  }
  if (existing.deletedAt) {
    throw conflict("This uploaded image has already been removed");
  }
  if (existing.consumedAt) {
    if (
      !allowConsumedProductCleanup ||
      existing.purpose !== "products" ||
      !existing.productId
    ) {
      throw conflict("This image is already attached to a saved record and cannot be removed here");
    }

    if (mode === "mongodb") {
      grant = plain(
        await UploadGrant.findOneAndUpdate(
          {
            publicId,
            userId,
            purpose: "products",
            consumedAt: { $exists: true },
            deletedAt: { $exists: false },
            $or: [{ reservationToken: "" }, { reservationToken: { $exists: false } }],
          },
          {
            $set: {
              reservationToken,
              reservedAt: now,
              reservationKind: "cleanup",
            },
          },
          { new: true, runValidators: true },
        ),
      );
    } else if (!existing.reservationToken) {
      grant = memoryStore.update("uploadGrants", existing.id, {
        reservationToken,
        reservedAt: now,
        reservationKind: "cleanup",
      });
    }
    if (!grant) {
      throw conflict("This upload is currently being finalized. Please try again");
    }
    if (await productReferencesPublicId(publicId, mode)) {
      await releaseUploadGrantReservation(reservationToken).catch(() => {});
      throw conflict("Remove this image from the product and save it before deleting the asset");
    }
    return { ...grant, provenanceRetained: true };
  }
  if (existing.expiresAt <= now) throw conflict("This upload grant has expired");
  throw conflict("This upload is currently being finalized. Please try again");
};

export const deleteClaimedUploadGrant = async ({
  userId,
  publicId,
  reservationToken,
}) => {
  const mode = assertWritable(await connectDatabase());
  if (mode === "mongodb") {
    const tombstone = await UploadGrant.findOneAndUpdate(
      {
        publicId,
        userId,
        reservationToken,
        reservationKind: "cleanup",
        purpose: "products",
        consumedAt: { $exists: true },
        deletedAt: { $exists: false },
      },
      {
        $set: {
          deletedAt: new Date(),
          deletedByUserId: userId,
          reservationToken: "",
        },
        $unset: { reservedAt: 1, reservationKind: 1 },
      },
      { new: true },
    );
    if (tombstone) return { provenanceRetained: true };

    const result = await UploadGrant.deleteOne({
      publicId,
      userId,
      reservationToken,
      reservationKind: "cleanup",
      consumedAt: { $exists: false },
    });
    if (result.deletedCount !== 1) {
      throw conflict("The upload cleanup could not be finalized");
    }
    return { provenanceRetained: false };
  }
  const grant = memoryStore.get("uploadGrants", publicId);
  if (
    !grant ||
    grant.userId !== userId ||
    grant.reservationToken !== reservationToken ||
    grant.reservationKind !== "cleanup"
  ) {
    throw conflict("The upload cleanup could not be finalized");
  }
  if (grant.consumedAt) {
    if (grant.purpose !== "products" || grant.deletedAt) {
      throw conflict("The upload cleanup could not be finalized");
    }
    memoryStore.update("uploadGrants", grant.id, {
      deletedAt: new Date(),
      deletedByUserId: userId,
      reservationToken: "",
      reservedAt: null,
      reservationKind: undefined,
    });
    return { provenanceRetained: true };
  }
  memoryStore.remove("uploadGrants", grant.id);
  return { provenanceRetained: false };
};
