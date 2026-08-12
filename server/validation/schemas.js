import { z } from "zod";

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
  .regex(/^\+?[0-9\s()-]+$/, "Enter a valid Indian mobile number")
  .refine((value) => {
    const digits = value.replace(/\D/g, "");
    const local = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
    return /^[6-9][0-9]{9}$/.test(local);
  }, "Enter a valid 10-digit Indian mobile number")
  .transform((value) => {
    const digits = value.replace(/\D/g, "");
    const local = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
    return `+91${local}`;
  });
const relativeOrAbsoluteUrl = z
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
const optionalBlank = (schema) => z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

export const googleLoginSchema = z
  .object({
    credential: text(20, 10_000).optional(),
    idToken: text(20, 10_000).optional(),
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
    featured: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
    page: integerInput({ min: 1, max: 10_000 }).default(1),
    limit: integerInput({ min: 1, max: 50 }).default(12),
  })
  .strict();

export const slugParamsSchema = z
  .object({ slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(160) })
  .strict();

const imageSchema = z
  .object({
    url: relativeOrHttpsUrl,
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
  shortDescription: text(10, 240),
  description: z.string().trim().max(4_000),
  sku: skuSchema,
  price: integerInput({ min: 0, max: 10_000_000 }),
  compareAtPrice: z.preprocess(
    (value) => (value === "" ? null : value),
    numberInput(z.number().int().min(0).max(10_000_000).nullable()),
  ),
  images: z.array(imageSchema).max(10),
  tags: z.array(text(1, 50)).max(30),
  customizationOptions: z.array(text(1, 100)).max(30),
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
    description: productUpdateFields.description.default(""),
    sku: productUpdateFields.sku.default(""),
    compareAtPrice: productUpdateFields.compareAtPrice.default(null),
    images: productUpdateFields.images.default([]),
    tags: productUpdateFields.tags.default([]),
    customizationOptions: productUpdateFields.customizationOptions.default([]),
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

const relativeOrHttpsUrlOrBlank = z.union([z.literal(""), relativeOrHttpsUrl]);
const emailOrBlank = z.union([z.literal(""), email]);
const phoneOrBlank = z.union([z.literal(""), phone]);
const instagramOrBlank = z.string().trim().max(200).refine((value) => {
  if (!value) return true;
  if (/^@[A-Za-z0-9._]{1,30}$/.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && /(^|\.)instagram\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}, "Enter an @handle or an HTTPS Instagram URL");

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
    note: z.string().trim().max(1_000).default(""),
    paymentMethod: z.literal("manual_confirmation").default("manual_confirmation"),
  })
  .strict();

export const orderQuerySchema = z
  .object({
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
    note: z.string().trim().max(500).default(""),
  })
  .strict();

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
    referenceUrl: optionalBlank(relativeOrAbsoluteUrl),
    referenceImages: z.array(relativeOrAbsoluteUrl).max(5).default([]),
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
    referenceImages: [...new Set([...value.referenceImages, value.referenceUrl].filter(Boolean))],
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
    adminNote: z.string().trim().max(2_000).optional(),
  })
  .strict();

export const contactStatusSchema = z
  .object({
    status: z.enum(["new", "read", "replied", "archived"]),
    adminNote: z.string().trim().max(2_000).optional(),
  })
  .strict();

export const uploadSignatureSchema = z
  .object({
    purpose: z.enum(["custom-inquiries", "orders", "profiles", "products"]).default("custom-inquiries"),
  })
  .strict();
