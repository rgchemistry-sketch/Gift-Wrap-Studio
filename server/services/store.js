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

export const createProduct = async (input) => {
  const mode = assertWritable(await ensureCatalogSeeded());
  if (mode === "mongodb") return plain(await Product.create(input));
  if (memoryStore.findOne("products", (product) => product.slug === input.slug)) {
    throw conflict("A product with this slug already exists", [{ field: "slug" }]);
  }
  return memoryStore.create("products", input);
};

export const updateProduct = async (id, input) => {
  const mode = assertWritable(await ensureCatalogSeeded());
  if (mode === "mongodb") {
    if (!mongoose.isValidObjectId(id)) throw notFound("Product");
    const record = await Product.findByIdAndUpdate(id, { $set: input }, { new: true, runValidators: true });
    if (!record) throw notFound("Product");
    return plain(record);
  }
  if (
    input.slug &&
    memoryStore.findOne("products", (product) => product.slug === input.slug && product.id !== id)
  ) {
    throw conflict("A product with this slug already exists", [{ field: "slug" }]);
  }
  const record = memoryStore.update("products", id, input);
  if (!record) throw notFound("Product");
  return record;
};

export const archiveProduct = async (id) => updateProduct(id, { active: false });

export const upsertGoogleUser = async ({ googleSub, email, name, avatar }) => {
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
  };
  record = record ? memoryStore.update("users", record.id, changes) : memoryStore.create("users", changes);
  return record;
};

export const getUserById = async (id) => {
  const mode = await connectDatabase();
  if (mode === "mongodb") {
    if (!mongoose.isValidObjectId(id)) return undefined;
    return plain(await User.findById(id));
  }
  return memoryStore.get("users", id);
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
  const shippingFee = subtotal >= env.freeShippingThreshold ? 0 : env.flatShippingFee;
  let discount = 0;

  if (input.couponCode) {
    if (input.couponCode !== env.welcomeCouponCode || env.welcomeDiscountPercent === 0) {
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
      (quantity) => quantity >= env.bulkOrderThreshold,
    );
    if (hasCorporateItem || hasBulkItem) {
      throw badRequest(
        `The welcome offer is not available for corporate gifts or quantities of ${env.bulkOrderThreshold} or more`,
      );
    }
    discount = Math.min(
      Math.round((subtotal * env.welcomeDiscountPercent) / 100),
      env.welcomeDiscountMax,
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

export const getDashboardStats = async () => {
  const mode = await ensureCatalogSeeded();
  if (mode === "mongodb") {
    const [products, orders, newInquiries, newMessages] = await Promise.all([
      Product.countDocuments({ active: true }),
      Order.countDocuments({}),
      CustomInquiry.countDocuments({ status: "new" }),
      Contact.countDocuments({ status: "new" }),
    ]);
    return { products, orders, newInquiries, newMessages };
  }
  return {
    products: memoryStore.count("products", (product) => product.active),
    orders: memoryStore.count("orders"),
    newInquiries: memoryStore.count("customInquiries", (inquiry) => inquiry.status === "new"),
    newMessages: memoryStore.count("contacts", (contact) => contact.status === "new"),
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
