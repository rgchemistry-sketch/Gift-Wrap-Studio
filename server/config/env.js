const asInteger = (value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
};

const asBoolean = (value, fallback = false) => {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
};

const list = (value) =>
  String(value ?? "")
    .split(",")
    .map((entry) => entry.trim().replace(/\/$/, ""))
    .filter(Boolean);

const nodeEnv = process.env.NODE_ENV || "development";
const isProduction = nodeEnv === "production";
const allowDemoAuth = asBoolean(process.env.ALLOW_DEMO_AUTH, false) && !isProduction;

const configuredOrigins = list(
  process.env.CLIENT_ORIGINS || process.env.CLIENT_ORIGIN || process.env.VITE_APP_URL,
);

export const env = Object.freeze({
  nodeEnv,
  isProduction,
  isTest: nodeEnv === "test",
  allowDemoAuth,
  allowMemoryWrites: asBoolean(process.env.ALLOW_MEMORY_WRITES, !isProduction),
  port: asInteger(process.env.PORT, 4000, { min: 1, max: 65_535 }),
  mongodbUri: process.env.MONGODB_URI?.trim() || "",
  mongodbDatabase: process.env.MONGODB_DATABASE?.trim() || "gift_n_wrap",
  mongoTimeoutMs: asInteger(process.env.MONGODB_TIMEOUT_MS, 4_000, {
    min: 500,
    max: 30_000,
  }),
  jwtSecret: process.env.JWT_SECRET?.trim() || "",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN?.trim() || "7d",
  jwtIssuer: process.env.JWT_ISSUER?.trim() || "gift-n-wrap-api",
  cookieName: process.env.AUTH_COOKIE_NAME?.trim() || "gnw_session",
  cookieDays: asInteger(process.env.AUTH_COOKIE_DAYS, 7, { min: 1, max: 30 }),
  cookieSameSite: ["lax", "strict", "none"].includes(
    String(process.env.COOKIE_SAME_SITE || "lax").toLowerCase(),
  )
    ? String(process.env.COOKIE_SAME_SITE || "lax").toLowerCase()
    : "lax",
  googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() || "",
  resendApiKey: process.env.RESEND_API_KEY?.trim() || "",
  authEmailFrom: process.env.AUTH_EMAIL_FROM?.trim() || "",
  authEmailReplyTo: process.env.AUTH_EMAIL_REPLY_TO?.trim() || "",
  emailOtpSecret: process.env.EMAIL_OTP_SECRET?.trim() || "",
  emailOtpChallengeMinutes: asInteger(process.env.EMAIL_OTP_CHALLENGE_MINUTES, 10, {
    min: 2,
    max: 30,
  }),
  emailOtpResendSeconds: asInteger(process.env.EMAIL_OTP_RESEND_SECONDS, 60, {
    min: 30,
    max: 600,
  }),
  emailOtpMaxAttempts: asInteger(process.env.EMAIL_OTP_MAX_ATTEMPTS, 5, {
    min: 3,
    max: 10,
  }),
  demoEmailOtpCode: /^\d{6}$/.test(process.env.DEMO_EMAIL_OTP_CODE || "")
    ? process.env.DEMO_EMAIL_OTP_CODE
    : "246810",
  adminEmail:
    process.env.ADMIN_EMAIL?.trim().toLowerCase() ||
    (allowDemoAuth ? "admin@giftnwrap.local" : ""),
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME?.trim() || "",
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY?.trim() || "",
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET?.trim() || "",
  cloudinaryUploadPreset: process.env.CLOUDINARY_UPLOAD_PRESET?.trim() || "",
  clientOrigins:
    configuredOrigins.length > 0
      ? configuredOrigins
      : isProduction
        ? []
        : ["http://localhost:5173", "http://127.0.0.1:5173"],
  trustProxy: asBoolean(process.env.TRUST_PROXY, isProduction),
  flatShippingFee: asInteger(process.env.FLAT_SHIPPING_FEE, 99, { min: 0, max: 10_000 }),
  freeShippingThreshold: asInteger(process.env.FREE_SHIPPING_THRESHOLD, 2_000, {
    min: 0,
    max: 1_000_000,
  }),
  welcomeCouponCode: (process.env.WELCOME_COUPON_CODE || "FIRST10").trim().toUpperCase(),
  welcomeDiscountPercent: asInteger(process.env.WELCOME_DISCOUNT_PERCENT, 10, {
    min: 0,
    max: 100,
  }),
  welcomeDiscountMax: asInteger(process.env.WELCOME_DISCOUNT_MAX, 500, {
    min: 0,
    max: 100_000,
  }),
  bulkOrderThreshold: asInteger(process.env.BULK_ORDER_THRESHOLD, 10, { min: 2, max: 100 }),
  uploadSignaturesPerHour: asInteger(process.env.UPLOAD_SIGNATURES_PER_HOUR, 20, {
    min: 1,
    max: 200,
  }),
});

export const emailAuthStatus = () => {
  const hasSigningSecret = Boolean(env.emailOtpSecret);
  const configured = Boolean(env.resendApiKey && env.authEmailFrom && hasSigningSecret);
  const demo = Boolean(env.allowDemoAuth && !env.isProduction && hasSigningSecret && !configured);
  return {
    provider: configured ? "resend" : demo ? "local-demo" : "resend",
    enabled: configured || demo,
    configured,
    demo,
  };
};

export const authProviderStatus = () => ({
  google: { enabled: Boolean(env.googleClientId) },
  email: emailAuthStatus(),
});

export const missingConfig = (...keys) => keys.filter((key) => !env[key]);
