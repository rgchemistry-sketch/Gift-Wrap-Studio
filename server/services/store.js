import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { connectDatabase } from "../config/database.js";
import { env } from "../config/env.js";
import { demoProducts } from "../data/demo-products.js";
import {
  badRequest,
  conflict,
  databaseUnavailable,
  notFound,
  rateLimited,
} from "../lib/errors.js";
import { memoryStore } from "../lib/memory-store.js";
import { Contact } from "../models/Contact.js";
import { CustomInquiry } from "../models/CustomInquiry.js";
import { Order } from "../models/Order.js";
import { Product } from "../models/Product.js";
import { StudioSettings } from "../models/StudioSettings.js";
import { User } from "../models/User.js";
import { UploadGrant, UploadQuota } from "../models/UploadGrant.js";

const clone = (value) => (value == null ? value : structuredClone(value));

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

let mongoSeedPromise;

export const ensureCatalogSeeded = async () => {
  const mode = await connectDatabase();

  if (mode === "mongodb") {
    if (!mongoSeedPromise) {
      mongoSeedPromise = (async () => {
        if ((await Product.estimatedDocumentCount()) > 0) return;
        const seeds = demoProducts.map(({ id: _id, ...product }) => product);
        try {
          await Product.insertMany(seeds, { ordered: false });
        } catch (error) {
          if (error?.code !== 11_000 && error?.code !== 11000) throw error;
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

export const listProducts = async ({ search, category, featured, page, limit }) => {
  const mode = await ensureCatalogSeeded();

  if (mode === "mongodb") {
    const query = { active: true };
    if (category) query.category = category;
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
    .filter((product) => featured === undefined || product.featured === featured)
    .filter(
      (product) =>
        !needle ||
        [product.name, product.shortDescription, ...(product.tags || [])]
          .join(" ")
          .toLowerCase()
          .includes(needle),
    )
    .sort((a, b) => a.sortOrder - b.sortOrder || Number(b.featured) - Number(a.featured));
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

export const listAllProductsForAdmin = async () => {
  const mode = await ensureCatalogSeeded();
  const records =
    mode === "mongodb"
      ? await Product.find({}).sort({ active: -1, sortOrder: 1, createdAt: -1 })
      : memoryStore
          .all("products")
          .sort((a, b) => Number(b.active) - Number(a.active) || a.sortOrder - b.sortOrder);
  return records.map(plain);
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
    const expectedPrefix = env.cloudinaryCloudName
      ? `/image/upload/`
      : "/image/upload/";
    if (
      imageUrl.protocol !== "https:" ||
      imageUrl.hostname.toLowerCase() !== "res.cloudinary.com" ||
      (env.cloudinaryCloudName && !imageUrl.pathname.startsWith(`/${env.cloudinaryCloudName}${expectedPrefix}`))
    ) {
      throw badRequest("Product image public IDs must belong to the configured Cloudinary account", [
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

export const createProduct = async (input) => {
  const mode = assertWritable(await ensureCatalogSeeded());
  assertProductInvariants(input);
  await assertProductSkusAvailable(input, mode);
  if (mode === "mongodb") return plain(await Product.create(input));
  if (memoryStore.findOne("products", (product) => product.slug === input.slug)) {
    throw conflict("A product with this slug already exists", [{ field: "slug" }]);
  }
  return memoryStore.create("products", input);
};

export const updateProduct = async (id, input) => {
  const mode = assertWritable(await ensureCatalogSeeded());
  const changes = input.active === true ? { ...input, archivedAt: null } : input;
  if (mode === "mongodb") {
    if (!mongoose.isValidObjectId(id)) throw notFound("Product");
    const existing = plain(await Product.findById(id));
    if (!existing) throw notFound("Product");
    const candidate = { ...existing, ...changes };
    assertProductInvariants(candidate);
    await assertProductSkusAvailable(candidate, mode, new mongoose.Types.ObjectId(id));
    const record = await Product.findByIdAndUpdate(id, { $set: changes }, { new: true, runValidators: true });
    if (!record) throw notFound("Product");
    return plain(record);
  }
  if (
    input.slug &&
    memoryStore.findOne("products", (product) => product.slug === input.slug && product.id !== id)
  ) {
    throw conflict("A product with this slug already exists", [{ field: "slug" }]);
  }
  const existing = memoryStore.get("products", id);
  if (!existing) throw notFound("Product");
  const candidate = { ...existing, ...changes };
  assertProductInvariants(candidate);
  await assertProductSkusAvailable(candidate, mode, id);
  const record = memoryStore.update("products", id, changes);
  if (!record) throw notFound("Product");
  return record;
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
        name,
        avatar: avatar || "",
        role,
        lastLoginAt: new Date(),
        ...(phone ? { phone, phoneVerifiedAt: phoneVerifiedAt || new Date() } : {}),
      });
      await record.save();
    } else {
      record = await User.create({
        googleSub,
        email: normalizedEmail,
        name,
        avatar: avatar || "",
        role,
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
    name,
    avatar: avatar || "",
    role,
    lastLoginAt: new Date(),
    ...(phone ? { phone, phoneVerifiedAt: phoneVerifiedAt || new Date() } : {}),
  };
  record = record ? memoryStore.update("users", record.id, changes) : memoryStore.create("users", changes);
  return record;
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

const defaultStudioSettings = () => ({
  leadTimes: {
    ready: "3–10 business days",
    custom: "5–15 business days",
  },
  offer: {
    enabled: env.welcomeDiscountPercent > 0,
    eyebrow: "A little welcome gift",
    title: "Make your first story together.",
    body: "Enjoy a thoughtful saving on your first Gift N Wrap Studio order.",
    code: env.welcomeCouponCode,
    percent: env.welcomeDiscountPercent,
    maxDiscount: env.welcomeDiscountMax,
    delaySeconds: 5,
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
      { ...fallback, ...(current[group] || {}), ...(changes[group] || {}) },
    ]),
  );
};

const publicStudioSettings = (record) => {
  const settings = mergeStudioSettings(record);
  let instagramHandle = settings.contact.instagram.startsWith("@")
    ? settings.contact.instagram
    : "";
  if (!instagramHandle && settings.contact.instagram.startsWith("https://")) {
    try {
      const [username] = new URL(settings.contact.instagram).pathname.split("/").filter(Boolean);
      if (username) instagramHandle = `@${username}`;
    } catch {
      instagramHandle = "";
    }
  }
  settings.contact.instagramHandle = instagramHandle;
  settings.contact.instagramUrl = settings.contact.instagram.startsWith("https://")
    ? settings.contact.instagram
    : settings.contact.instagram
      ? `https://www.instagram.com/${settings.contact.instagram.replace(/^@/, "")}`
      : "";
  return settings;
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
    const query = slug
      ? { slug, active: true }
      : mongoose.isValidObjectId(productId)
        ? { _id: productId, active: true }
        : { _id: null };
    return plain(await Product.findOne(query));
  }
  return memoryStore.findOne(
    "products",
    (product) => product.active && (slug ? product.slug === slug : product.id === productId),
  );
};

const orderNumber = () => {
  const date = new Date().toISOString().slice(2, 10).replaceAll("-", "");
  return `GNW-${date}-${randomBytes(3).toString("hex").toUpperCase()}`;
};

const hasOrdersForBuyer = async (buyerId, mode) =>
  mode === "mongodb"
    ? Boolean(await Order.exists({ buyerId }))
    : memoryStore.count("orders", (order) => order.buyerId === buyerId) > 0;

const findIdempotentOrder = async (buyerId, idempotencyKey, mode) => {
  if (!idempotencyKey) return undefined;
  const record =
    mode === "mongodb"
      ? await Order.findOne({ buyerId, idempotencyKey }).select("+idempotencyKey +idempotencyHash")
      : memoryStore.findOne(
          "orders",
          (order) => order.buyerId === buyerId && order.idempotencyKey === idempotencyKey,
        );
  return plain(record);
};

const persistMongoOrder = async (record, stockRequests) => {
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
          if (!current) throw conflict(`${request.name} is no longer available`);
          if (current.price !== request.unitPrice) {
            throw conflict(`${request.name}'s price changed. Refresh your bag before ordering`);
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
    if (!current || !current.active) throw conflict(`${request.name} is no longer available`);
    if (current.price !== request.unitPrice) {
      throw conflict(`${request.name}'s price changed. Refresh your bag before ordering`);
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
    throw conflict("This Idempotency-Key was already used for a different order");
  }
  return order;
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
    if (!product) throw notFound("One of the selected products");
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

  const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const shippingFee =
    subtotal >= studioSettings.shipping.freeThreshold ? 0 : studioSettings.shipping.flatFee;
  let discount = 0;

  if (input.couponCode) {
    if (
      !studioSettings.offer.enabled ||
      input.couponCode !== studioSettings.offer.code ||
      studioSettings.offer.percent === 0
    ) {
      throw badRequest("This coupon code is not valid");
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
      throw badRequest(
        `The welcome offer is not available for corporate gifts or quantities of ${studioSettings.shipping.bulkThreshold} or more`,
      );
    }
    discount = Math.min(
      Math.round((subtotal * studioSettings.offer.percent) / 100),
      studioSettings.offer.maxDiscount,
    );
  }

  const hasPriorOrder = await hasOrdersForBuyer(buyer.id, mode);
  if (input.couponCode && hasPriorOrder) {
    throw conflict("The welcome offer is available on your first order only");
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
          (order) => order.buyerId === buyer.id && order.idempotencyKey === idempotencyKey,
        )
      : undefined;
    if (repeated) {
      return {
        order: publicOrder(assertMatchingReplay(repeated, idempotencyHash)),
        replayed: true,
      };
    }
    const firstOrderNow = !memoryStore.findOne("orders", (order) => order.buyerId === buyer.id);
    if (input.couponCode && !firstOrderNow) {
      throw conflict("The welcome offer is available on your first order only");
    }
    const inventoryReservations = reserveMemoryInventory(stockRequests);
    return {
      order: publicOrder(
        memoryStore.create("orders", {
          ...record,
          isFirstOrder: firstOrderNow,
          inventoryReservations,
          inventoryReleasedAt: null,
        }),
      ),
      replayed: false,
    };
  }

  try {
    return { order: publicOrder(await persistMongoOrder(record, stockRequests)), replayed: false };
  } catch (error) {
    const repeated = await findIdempotentOrder(buyer.id, idempotencyKey, mode);
    if (repeated) {
      return {
        order: publicOrder(assertMatchingReplay(repeated, idempotencyHash)),
        replayed: true,
      };
    }

    if (record.isFirstOrder && duplicateIndex(error, "uniq_buyer_first_order", "isFirstOrder")) {
      if (input.couponCode) {
        throw conflict("The welcome offer is available on your first order only");
      }
      return {
        order: publicOrder(
          await persistMongoOrder({ ...record, isFirstOrder: false }, stockRequests),
        ),
        replayed: false,
      };
    }
    if (duplicateIndex(error, "uniq_buyer_welcome_offer", "welcomeOfferClaimed")) {
      throw conflict("The welcome offer is available on your first order only");
    }
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

export const listAllOrders = async ({ status, page, limit }) => {
  const mode = await connectDatabase();
  if (mode === "mongodb") {
    const query = status ? { status } : {};
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

export const updateOrderStatus = async (id, { status, note }) => {
  const mode = assertWritable(await connectDatabase());
  const now = new Date();
  const entry = { status, note, at: now };

  if (mode === "mongodb") {
    const session = await mongoose.startSession();
    let updated;
    try {
      await session.withTransaction(
        async () => {
          const query = mongoose.isValidObjectId(id) ? { _id: id } : { orderNumber: id };
          const order = await Order.findOne(query)
            .select("+inventoryReservations +inventoryReleasedAt")
            .session(session);
          if (!order) throw notFound("Order");
          assertStatusTransition(order.status, status);

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
          order.status = status;
          order.statusHistory.push(entry);
          updated = await order.save({ session });
        },
        {
          readConcern: { level: "snapshot" },
          writeConcern: { w: "majority" },
        },
      );
      return publicOrder(updated);
    } finally {
      await session.endSession();
    }
  }

  const existing =
    memoryStore.get("orders", id) ||
    memoryStore.findOne("orders", (order) => order.orderNumber === id);
  if (!existing) throw notFound("Order");
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
  return publicOrder(
    memoryStore.update("orders", existing.id, {
      status,
      inventoryReleasedAt,
      statusHistory: [...existing.statusHistory, entry],
    }),
  );
};

export const createCustomInquiry = async (input, user) => {
  const mode = assertWritable(await connectDatabase());
  const record = { ...input, userId: user?.id || "", status: "new", adminNote: "" };
  return mode === "mongodb"
    ? plain(await CustomInquiry.create(record))
    : memoryStore.create("customInquiries", record);
};

export const listBuyerInquiries = async (userId) => {
  const mode = await connectDatabase();
  const records =
    mode === "mongodb"
      ? await CustomInquiry.find({ userId }).sort({ createdAt: -1 })
      : memoryStore
          .find("customInquiries", (inquiry) => inquiry.userId === userId)
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return records.map((record) => {
    const buyerSafe = plain(record);
    delete buyerSafe.adminNote;
    return buyerSafe;
  });
};

const listInbox = async (collectionName, Model, { status, page, limit }) => {
  const mode = await connectDatabase();
  if (mode === "mongodb") {
    const query = status ? { status } : {};
    const [records, total] = await Promise.all([
      Model.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
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
  if (mode === "mongodb") {
    if (!mongoose.isValidObjectId(id)) throw notFound(resourceName);
    const record = await Model.findByIdAndUpdate(id, { $set: input }, { new: true, runValidators: true });
    if (!record) throw notFound(resourceName);
    return plain(record);
  }
  const record = memoryStore.update(collectionName, id, input);
  if (!record) throw notFound(resourceName);
  return record;
};

export const listCustomInquiries = (query) =>
  listInbox("customInquiries", CustomInquiry, query);

export const updateCustomInquiry = (id, input) =>
  updateInbox("customInquiries", CustomInquiry, id, input, "Custom inquiry");

export const createContact = async (input) => {
  const mode = assertWritable(await connectDatabase());
  const record = { ...input, phone: input.phone || "", status: "new", adminNote: "" };
  return mode === "mongodb" ? plain(await Contact.create(record)) : memoryStore.create("contacts", record);
};

export const listContacts = (query) => listInbox("contacts", Contact, query);

export const updateContact = (id, input) =>
  updateInbox("contacts", Contact, id, input, "Contact message");

const maskPhone = (phone) => {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  return `+91 ••••••${local.slice(-4)}`;
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
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
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

export const getRegisteredUserMetrics = async (selectedMode) => {
  const mode = selectedMode || (await connectDatabase());
  const now = new Date();
  const monthStartedAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000);
  if (mode === "mongodb") {
    const [
      total,
      buyers,
      admins,
      phoneVerified,
      signupsLast7Days,
      signupsLast30Days,
      newThisMonth,
      repeatCustomerRows,
    ] =
      await Promise.all([
        User.countDocuments({}),
        User.countDocuments({ role: "buyer" }),
        User.countDocuments({ role: "admin" }),
        User.countDocuments({ phoneVerifiedAt: { $ne: null } }),
        User.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
        User.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
        User.countDocuments({ createdAt: { $gte: monthStartedAt } }),
        Order.aggregate([
          { $match: { status: { $ne: "cancelled" } } },
          { $group: { _id: "$buyerId", ordersCount: { $sum: 1 } } },
          { $match: { ordersCount: { $gte: 2 } } },
          { $count: "total" },
        ]),
      ]);
    return {
      total,
      buyers,
      admins,
      phoneVerified,
      signupsLast7Days,
      signupsLast30Days,
      newThisMonth,
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
    repeatCustomers: users.filter(
      (user) =>
        memoryStore.count(
          "orders",
          (order) => order.buyerId === user.id && order.status !== "cancelled",
        ) >= 2,
    ).length,
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
  if (mode === "mongodb") {
    const [products, orders, newInquiries, newMessages, userMetrics] = await Promise.all([
      Product.countDocuments({ active: true }),
      Order.countDocuments({}),
      CustomInquiry.countDocuments({ status: "new" }),
      Contact.countDocuments({ status: "new" }),
      getRegisteredUserMetrics(mode),
    ]);
    return {
      products,
      orders,
      newInquiries,
      newMessages,
      users: userMetrics.total,
      registeredUsers: userMetrics.buyers,
      verifiedPhoneUsers: userMetrics.phoneVerified,
      signupsLast30Days: userMetrics.signupsLast30Days,
      newUsersThisMonth: userMetrics.newThisMonth,
    };
  }
  const userMetrics = await getRegisteredUserMetrics(mode);
  return {
    products: memoryStore.count("products", (product) => product.active),
    orders: memoryStore.count("orders"),
    newInquiries: memoryStore.count("customInquiries", (inquiry) => inquiry.status === "new"),
    newMessages: memoryStore.count("contacts", (contact) => contact.status === "new"),
    users: userMetrics.total,
    registeredUsers: userMetrics.buyers,
    verifiedPhoneUsers: userMetrics.phoneVerified,
    signupsLast30Days: userMetrics.signupsLast30Days,
    newUsersThisMonth: userMetrics.newThisMonth,
  };
};

export const reserveUploadGrant = async ({ userId, purpose, publicId }) => {
  const mode = assertWritable(await connectDatabase());
  const now = Date.now();
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
    await UploadGrant.create({
      publicId,
      userId,
      purpose,
      expiresAt: new Date(now + 2 * 3_600_000),
    });
    return;
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
  memoryStore.create(
    "uploadGrants",
    { publicId, userId, purpose, expiresAt: new Date(now + 2 * 3_600_000) },
    publicId,
  );
};
