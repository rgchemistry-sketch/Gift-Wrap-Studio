import { z } from "zod";
import {
  INSTAGRAM_PROFILE_MESSAGE,
  normalizeInstagramProfile,
} from "../../shared/social-profiles.js";
import {
  INDIAN_MOBILE_MESSAGE,
  normalizeIndianMobile,
} from "../../shared/indian-phone.js";

const text = (min, max) => z.string().trim().min(min).max(max);
const email = z.string().trim().toLowerCase().email().max(254);
const numberInput = (schema) =>
  z.preprocess((value) => {
    if (typeof value !== "string") return value;
    const normalized = value.trim();
    return /^-?(?:\d+|\d*\.\d+)$/.test(normalized) ? Number(normalized) : value;
  }, schema);
const integerInput = ({ min, max }) => numberInput(z.number().int().min(min).max(max));
const phone = z
  .string()
  .trim()
  .max(24, INDIAN_MOBILE_MESSAGE)
  .refine((value) => normalizeIndianMobile(value) !== null, INDIAN_MOBILE_MESSAGE)
  .transform((value) => normalizeIndianMobile(value));
const relativeOrHttpsUrl = z
  .string()
  .trim()
  .max(1_000)
  .refine(
    (value) => {
      if (value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\")) {
        return true;
      }
      try {
        return new URL(value).protocol === "https:";
      } catch {
        return false;
      }
    },
    "Enter an HTTPS URL or a site-relative path",
  );
const inspirationReferenceUrl = z
  .string()
  .trim()
  .max(1_000)
  .refine(
    (value) => {
      if (value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\")) {
        return true;
      }
      try {
        return ["http:", "https:"].includes(new URL(value).protocol);
      } catch {
        return false;
      }
    },
    "Enter an HTTP(S) URL or a site-relative path",
  );
const productImageUrl = relativeOrHttpsUrl.refine(
  (value) => {
    if (value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\")) {
      return true;
    }
    try {
      return new URL(value).hostname.toLowerCase() === "res.cloudinary.com";
    } catch {
      return false;
    }
  },
  "Use a Cloudinary HTTPS URL or a site-relative path",
);
const uploadedReferenceImageUrl = relativeOrHttpsUrl.refine(
  (value) => {
    if (value.startsWith("/")) return false;
    try {
      return new URL(value).hostname.toLowerCase() === "res.cloudinary.com";
    } catch {
      return false;
    }
  },
  "Use the secure Cloudinary URL returned by the upload service",
);
const optionalBlank = (schema) => z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

export const googleLoginSchema = z
  .object({
    credential: text(20, 10_000).optional(),
    idToken: text(20, 10_000).optional(),
    intent: z.enum(["login", "signup"]),
  })
  .strict()
  .refine((value) => Boolean(value.credential || value.idToken), {
    message: "A Google credential is required",
    path: ["credential"],
  });

export const demoLoginSchema = z
  .object({ role: z.enum(["buyer", "admin"]).default("buyer") })
  .strict();

export const productQuerySchema = z
  .object({
    search: optionalBlank(text(1, 100)),
    category: optionalBlank(text(1, 80)),
    occasion: optionalBlank(text(1, 80)),
    featured: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
    page: integerInput({ min: 1, max: 10_000 }).default(1),
    limit: integerInput({ min: 1, max: 100 }).default(50),
  })
  .strict();

export const adminProductQuerySchema = z
  .object({
    q: optionalBlank(text(1, 100)),
    status: z.enum(["all", "current", "published", "draft", "archived"]).default("all"),
    page: integerInput({ min: 1, max: 10_000 }).default(1),
    limit: integerInput({ min: 1, max: 50 }).default(20),
  })
  .strict();

export const slugParamsSchema = z
  .object({ slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(160) })
  .strict();

const imageSchema = z
  .object({
    url: productImageUrl,
    publicId: z
      .string()
      .trim()
      .max(300)
      .regex(/^[A-Za-z0-9_/-]*$/, "Enter a valid Cloudinary public ID")
      .default(""),
    alt: z.string().trim().max(160).default(""),
  })
  .strict();

const skuSchema = z
  .string()
  .trim()
  .max(80)
  .transform((value) => value.toUpperCase())
  .refine(
    (value) => value === "" || /^[A-Z0-9][A-Z0-9._/-]*$/.test(value),
    "Use letters, numbers, dots, dashes, underscores or slashes",
  );

const productVariantSchema = z
  .object({
    name: text(1, 100),
    sku: skuSchema.default(""),
    price: z.preprocess(
      (value) => (value === "" ? null : value),
      numberInput(z.number().int().min(0).max(10_000_000).nullable()),
    ).default(null),
    inventory: z.preprocess(
      (value) => (value === "" ? null : value),
      numberInput(z.number().int().min(0).max(1_000_000).nullable()),
    ).default(null),
    active: z.boolean().default(true),
  })
  .strict();

const productUpdateFields = {
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(160),
  name: text(2, 140),
  category: text(2, 80),
  occasion: z.string().trim().max(80),
  shortDescription: text(10, 240),
  description: z.string().trim().max(4_000),
  sku: skuSchema,
  price: integerInput({ min: 0, max: 10_000_000 }),
  compareAtPrice: z.preprocess(
    (value) => (value === "" ? null : value),
    numberInput(z.number().int().min(0).max(10_000_000).nullable()),
  ),
  images: z.array(imageSchema).min(1, "Add at least one product image").max(10),
  tags: z.array(text(1, 50)).max(30),
  customizationOptions: z.array(text(1, 100)).max(30),
  customizationAvailable: z.boolean(),
  variants: z.array(productVariantSchema).max(100),
  featured: z.boolean(),
  active: z.boolean(),
  madeToOrder: z.boolean(),
  leadTimeDays: integerInput({ min: 1, max: 60 }),
  inventory: numberInput(z.number().int().min(0).max(1_000_000).nullable()),
  sortOrder: integerInput({ min: -10_000, max: 10_000 }),
};

export const createProductSchema = z
  .object({
    ...productUpdateFields,
    occasion: productUpdateFields.occasion.default(""),
    description: productUpdateFields.description.default(""),
    sku: productUpdateFields.sku.default(""),
    compareAtPrice: productUpdateFields.compareAtPrice.default(null),
    images: productUpdateFields.images,
    tags: productUpdateFields.tags.default([]),
    customizationOptions: productUpdateFields.customizationOptions.default([]),
    customizationAvailable: productUpdateFields.customizationAvailable.optional(),
    variants: productUpdateFields.variants.default([]),
    featured: productUpdateFields.featured.default(false),
    active: productUpdateFields.active.default(true),
    madeToOrder: productUpdateFields.madeToOrder.default(true),
    leadTimeDays: productUpdateFields.leadTimeDays.default(7),
    inventory: productUpdateFields.inventory.default(null),
    sortOrder: productUpdateFields.sortOrder.default(0),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.compareAtPrice != null && value.compareAtPrice < value.price) {
      context.addIssue({
        code: "custom",
        path: ["compareAtPrice"],
        message: "Compare-at price must be at least the selling price",
      });
    }
    const skus = [value.sku, ...value.variants.map((variant) => variant.sku)].filter(Boolean);
    if (new Set(skus).size !== skus.length) {
      context.addIssue({ code: "custom", path: ["variants"], message: "Product SKUs must be unique" });
    }
  });

export const updateProductSchema = z
  .object(
    Object.fromEntries(
      Object.entries(productUpdateFields).map(([key, schema]) => [key, schema.optional()]),
    ),
  )
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update")
  .superRefine((value, context) => {
    const skus = [value.sku, ...(value.variants || []).map((variant) => variant.sku)].filter(Boolean);
    if (new Set(skus).size !== skus.length) {
      context.addIssue({ code: "custom", path: ["variants"], message: "Product SKUs must be unique" });
    }
    if (
      value.price !== undefined &&
      value.compareAtPrice != null &&
      value.compareAtPrice < value.price
    ) {
      context.addIssue({
        code: "custom",
        path: ["compareAtPrice"],
        message: "Compare-at price must be at least the selling price",
      });
    }
  });

export const idParamsSchema = z.object({ id: text(1, 100) }).strict();

export const reviewParamsSchema = z.object({ id: text(1, 100) }).strict();

export const createReviewSchema = z
  .object({
    productId: text(1, 100),
    rating: integerInput({ min: 1, max: 5 }),
    comment: text(10, 1_000),
  })
  .strict();

export const updateReviewSchema = z
  .object({
    rating: integerInput({ min: 1, max: 5 }).optional(),
    comment: text(10, 1_000).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Provide a rating or comment to update");

export const publicReviewQuerySchema = z
  .object({ limit: integerInput({ min: 1, max: 24 }).default(12) })
  .strict();

const relativeOrHttpsUrlOrBlank = z.union([z.literal(""), relativeOrHttpsUrl]);
const emailOrBlank = z.union([z.literal(""), email]);
const phoneOrBlank = z.union([z.literal(""), phone]);
const instagramOrBlank = z
  .string()
  .trim()
  .max(200)
  .refine((value) => normalizeInstagramProfile(value) !== null, INSTAGRAM_PROFILE_MESSAGE);
const leadTimesSettingsSchema = z
  .object({
    ready: text(2, 120).optional(),
    custom: text(2, 120).optional(),
  })
  .strict();

const offerSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    eyebrow: text(1, 80).optional(),
    title: text(2, 140).optional(),
    body: text(2, 300).optional(),
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,40}$/).optional(),
    percent: integerInput({ min: 0, max: 100 }).optional(),
    maxDiscount: integerInput({ min: 0, max: 100_000 }).optional(),
    delaySeconds: integerInput({ min: 0, max: 60 }).optional(),
  })
  .strict();

const shippingSettingsSchema = z
  .object({
    flatFee: integerInput({ min: 0, max: 10_000 }).optional(),
    freeThreshold: integerInput({ min: 0, max: 1_000_000 }).optional(),
    bulkThreshold: integerInput({ min: 2, max: 100 }).optional(),
  })
  .strict();

const announcementSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    text: z.string().trim().max(160).optional(),
    linkLabel: z.string().trim().max(40).optional(),
    linkUrl: relativeOrHttpsUrlOrBlank.optional(),
  })
  .strict();

const contactSettingsSchema = z
  .object({
    email: emailOrBlank.optional(),
    phone: phoneOrBlank.optional(),
    instagram: instagramOrBlank.optional(),
  })
  .strict();

export const studioSettingsSchema = z
  .object({
    leadTimes: leadTimesSettingsSchema.optional(),
    offer: offerSettingsSchema.optional(),
    shipping: shippingSettingsSchema.optional(),
    announcement: announcementSettingsSchema.optional(),
    contact: contactSettingsSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      Object.values(value).some((group) => group && Object.keys(group).length > 0),
    "Provide at least one setting to update",
  );

export const adminUserQuerySchema = z
  .object({
    search: optionalBlank(text(1, 100)),
    role: z.enum(["buyer", "admin"]).optional(),
    phoneVerified: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
    page: integerInput({ min: 1, max: 10_000 }).default(1),
    limit: integerInput({ min: 1, max: 50 }).default(20),
  })
  .strict();

const orderItemSchema = z
  .object({
    productId: optionalBlank(text(1, 100)),
    slug: optionalBlank(z.string().trim().toLowerCase().max(160)),
    quantity: integerInput({ min: 1, max: 20 }),
    customization: z.string().trim().max(1_000).default(""),
  })
  .strict()
  .refine((item) => Boolean(item.productId || item.slug), {
    message: "Provide productId or slug",
    path: ["productId"],
  });

const shippingAddressSchema = z
  .object({
    recipientName: text(2, 100),
    phone,
    line1: text(3, 200),
    line2: z.string().trim().max(200).default(""),
    city: text(2, 100),
    state: text(2, 100),
    postalCode: z.string().trim().regex(/^[1-9][0-9]{5}$/, "Enter a valid 6-digit Indian PIN code"),
    country: z.literal("India").default("India"),
  })
  .strict();

export const createOrderSchema = z
  .object({
    items: z.array(orderItemSchema).min(1).max(20),
    shippingAddress: shippingAddressSchema,
    couponCode: z.string().trim().toUpperCase().max(40).default(""),
    neededBy: z
      .preprocess((value) => (value === "" || value == null ? undefined : value), z.coerce.date().optional()),
    contactPreference: optionalBlank(z.enum(["WhatsApp", "Phone call", "Email"])).default(""),
    note: z.string().trim().max(1_000).default(""),
    paymentMethod: z.literal("manual_confirmation").default("manual_confirmation"),
    policyConsent: z.object({
      accepted: z.literal(true),
      version: z.literal("2026-08-21"),
    }).strict(),
  })
  .strict();

export const orderQuerySchema = z
  .object({
    q: z.string().trim().max(120).default(""),
    status: optionalBlank(
      z.enum(["placed", "confirmed", "in_progress", "ready", "shipped", "delivered", "cancelled"]),
    ),
    page: integerInput({ min: 1, max: 10_000 }).default(1),
    limit: integerInput({ min: 1, max: 50 }).default(20),
  })
  .strict();

export const orderStatusSchema = z
  .object({
    status: z.enum(["placed", "confirmed", "in_progress", "ready", "shipped", "delivered", "cancelled"]),
    expectedStatus: optionalBlank(
      z.enum(["placed", "confirmed", "in_progress", "ready", "shipped", "delivered", "cancelled"]),
    ),
    undo: z.boolean().default(false),
    note: z.string().trim().max(500).default(""),
  })
  .strict();

export const paymentQuoteSchema = z
  .object({
    amountPaise: integerInput({ min: 100, max: 1_000_000_000 }),
    note: z.string().trim().max(500).default(""),
  })
  .strict();

export const razorpaySessionSchema = z
  .object({
    policyConsent: z.object({
      accepted: z.literal(true),
      version: z.literal("2026-08-21"),
    }).strict(),
  })
  .strict();

export const razorpayConfirmSchema = z
  .object({
    orderId: text(1, 100),
    razorpayOrderId: z.string().trim().regex(/^order_[A-Za-z0-9]+$/).max(100),
    razorpayPaymentId: z.string().trim().regex(/^pay_[A-Za-z0-9]+$/).max(100),
    razorpaySignature: z.string().trim().regex(/^[a-fA-F0-9]{64}$/),
  })
  .strict();

export const razorpayRefundSchema = z
  .object({
    amountPaise: integerInput({ min: 100, max: 1_000_000_000 }).optional(),
    reason: text(3, 500),
  })
  .strict();

const analyticsDateInput = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use dates in YYYY-MM-DD format");

export const salesAnalyticsQuerySchema = z
  .object({
    range: z.enum(["day", "week", "month", "year"]).default("month"),
    from: analyticsDateInput.optional(),
    to: analyticsDateInput.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (Boolean(value.from) !== Boolean(value.to)) {
      context.addIssue({
        code: "custom",
        path: [value.from ? "to" : "from"],
        message: "Choose both a start and end date",
      });
    }
  });

export const customInquirySchema = z
  .object({
    name: text(2, 100),
    email,
    phone,
    productId: z.string().trim().max(100).default(""),
    category: z.string().trim().max(80).default(""),
    productType: z.string().trim().max(80).default(""),
    occasion: z.string().trim().max(100).default(""),
    idea: text(10, 3_000).optional(),
    description: text(10, 3_000).optional(),
    customization: z.string().trim().max(2_000).default(""),
    personalization: z.string().trim().max(2_000).default(""),
    palette: z.string().trim().max(200).default(""),
    budget: z.string().trim().max(80).default(""),
    neededBy: z
      .preprocess((value) => (value === "" || value == null ? undefined : value), z.coerce.date().optional()),
    contactPreference: z.string().trim().max(50).default(""),
    referenceUrl: optionalBlank(inspirationReferenceUrl),
    referenceImages: z.array(uploadedReferenceImageUrl).max(5).default([]),
  })
  .strict()
  .refine((value) => Boolean(value.idea || value.description), {
    message: "Tell us about the design you have in mind",
    path: ["description"],
  })
  .transform((value) => ({
    name: value.name,
    email: value.email,
    phone: value.phone,
    productId: value.productId,
    category: value.category || value.productType,
    occasion: value.occasion,
    palette: value.palette,
    idea: value.idea || value.description,
    customization: [value.customization, value.personalization].filter(Boolean).join("\n"),
    budget: value.budget,
    neededBy: value.neededBy,
    contactPreference: value.contactPreference,
    referenceUrl: value.referenceUrl || "",
    referenceImages: [...new Set(value.referenceImages)],
  }));

export const contactSchema = z
  .object({
    name: text(2, 100),
    email,
    phone: optionalBlank(phone),
    subject: text(3, 160),
    message: text(10, 3_000),
  })
  .strict();

export const inboxQuerySchema = z
  .object({
    status: optionalBlank(text(1, 30)),
    page: integerInput({ min: 1, max: 10_000 }).default(1),
    limit: integerInput({ min: 1, max: 50 }).default(20),
  })
  .strict();

export const inquiryStatusSchema = z
  .object({
    status: z.enum(["new", "contacted", "quoted", "accepted", "closed"]),
    expectedStatus: optionalBlank(
      z.enum(["new", "contacted", "quoted", "accepted", "closed"]),
    ),
    undo: z.boolean().default(false),
    adminNote: z.string().trim().max(2_000).optional(),
  })
  .strict();

export const contactStatusSchema = z
  .object({
    status: z.enum(["new", "read", "replied", "archived"]),
    expectedStatus: optionalBlank(
      z.enum(["new", "read", "replied", "archived"]),
    ),
    undo: z.boolean().default(false),
    adminNote: z.string().trim().max(2_000).optional(),
  })
  .strict();

export const uploadSignatureSchema = z
  .object({
    purpose: z.enum(["custom-inquiries", "orders", "products"]).default("custom-inquiries"),
  })
  .strict();

const reservedUploadPublicId = z
  .string()
  .trim()
  .max(300)
  .regex(
    /^gift-n-wrap\/(?:custom-inquiries|orders|products)\/[A-Za-z0-9_-]+\/[0-9a-fA-F-]{36}$/,
    "Enter a valid reserved upload public ID",
  );

export const uploadCompleteSchema = z.object({ publicId: reservedUploadPublicId }).strict();

export const uploadAssetDeleteSchema = z.object({ publicId: reservedUploadPublicId }).strict();
