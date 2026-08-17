import express from "express";
import cookieParser from "cookie-parser";
import compression from "compression";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { connectDatabase, databaseStatus } from "./config/database.js";
import { env } from "./config/env.js";
import { asyncHandler } from "./lib/async-handler.js";
import { errorHandler, notFoundHandler, requestId } from "./middleware/errors.js";
import { isOriginAllowed, requireTrustedOrigin } from "./middleware/origin.js";
import { rateLimitHandler } from "./middleware/rate-limit.js";
import { adminRouter } from "./routes/admin.js";
import { authRouter } from "./routes/auth.js";
import { contactRouter } from "./routes/contact.js";
import { inquiriesRouter } from "./routes/inquiries.js";
import { offersRouter } from "./routes/offers.js";
import { ordersRouter } from "./routes/orders.js";
import { productsRouter } from "./routes/products.js";
import { settingsRouter } from "./routes/settings.js";
import { uploadsRouter } from "./routes/uploads.js";

const app = express();

app.disable("x-powered-by");
if (env.trustProxy) app.set("trust proxy", 1);

app.use(requestId);
app.use(
  cors((request, callback) => {
    const origin = request.get("origin");
    const allowed = isOriginAllowed(request, origin);
    callback(null, {
      origin: allowed ? origin || true : false,
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id", "Idempotency-Key", "X-Expected-User-Id"],
      maxAge: 86_400,
    });
  }),
);
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "same-site" },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        scriptSrc: [
          "'self'",
          "https://accounts.google.com",
        ],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: [
          "'self'",
          "data:",
          "blob:",
          "https://res.cloudinary.com",
          "https://*.googleusercontent.com",
        ],
        connectSrc: [
          "'self'",
          "https://accounts.google.com",
          "https://api.cloudinary.com",
        ],
        frameSrc: ["https://accounts.google.com"],
        upgradeInsecureRequests: env.isProduction ? [] : null,
      },
    },
  }),
);
app.use(compression());
app.use(requireTrustedOrigin);
app.use(express.json({ limit: "1mb", strict: true }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));
app.use(cookieParser());
app.use(
  "/api",
  rateLimit({
    windowMs: 15 * 60 * 1_000,
    limit: 300,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip: () => env.isTest,
    handler: rateLimitHandler("Too many requests. Please try again shortly"),
  }),
);

app.get("/api", (_request, response) => {
  response.json({
    data: {
      name: "Gift N Wrap API",
      version: "1.0.0",
      status: "ok",
    },
  });
});

app.get(
  "/api/health",
  asyncHandler(async (_request, response) => {
    await connectDatabase();
    const persistence = databaseStatus();
    const degraded =
      env.isProduction && persistence.mode === "memory" && !env.allowMemoryWrites;
    response.setHeader("Cache-Control", "no-store");
    response.status(degraded ? 503 : 200).json({
      data: {
        status: degraded ? "degraded" : "ok",
        persistence,
        writable: persistence.mode === "mongodb" || env.allowMemoryWrites,
        timestamp: new Date().toISOString(),
      },
    });
  }),
);

app.use("/api/auth", authRouter);
app.use("/api/products", productsRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/offers", offersRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/custom-inquiries", inquiriesRouter);
app.use("/api/contact", contactRouter);
app.use("/api/uploads", uploadsRouter);
app.use("/api/admin", adminRouter);

app.use(notFoundHandler);
app.use(errorHandler);

export { app };
export default app;
