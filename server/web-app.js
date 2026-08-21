import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import compression from "compression";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env.js";

const defaultClientDirectory = fileURLToPath(new URL("../dist/", import.meta.url));

const isApiPath = (requestPath) =>
  requestPath === "/api" || requestPath.startsWith("/api/");

const isClientRoute = (request) => {
  if (!["GET", "HEAD"].includes(request.method)) return false;
  if (path.extname(request.path) === "") return true;
  return (request.get("accept") || "").includes("text/html");
};

export const createWebApp = ({ apiApp, clientDirectory = defaultClientDirectory }) => {
  const indexPath = path.join(clientDirectory, "index.html");
  if (!existsSync(indexPath)) {
    throw new Error(`Client build not found at ${indexPath}. Run npm run build first.`);
  }

  const webApp = express();

  // Keep API routing inside the API app so its request IDs, security middleware,
  // rate limits, and structured error responses continue to apply.
  webApp.use((request, response, next) => {
    if (isApiPath(request.path)) return apiApp(request, response, next);
    return next();
  });

  webApp.use(
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
            "https://checkout.razorpay.com",
          ],
          styleSrc: ["'self'", "'unsafe-inline'"],
          fontSrc: ["'self'", "data:"],
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
            "https://api.razorpay.com",
            "https://checkout.razorpay.com",
          ],
          frameSrc: [
            "https://accounts.google.com",
            "https://api.razorpay.com",
            "https://checkout.razorpay.com",
          ],
          upgradeInsecureRequests: env.isProduction ? [] : null,
        },
      },
    }),
  );
  webApp.use(compression());
  webApp.use(
    "/assets",
    express.static(path.join(clientDirectory, "assets"), {
      immutable: true,
      maxAge: "1y",
    }),
  );
  webApp.use(express.static(clientDirectory, { index: false, maxAge: 0 }));

  // React Router owns non-file GET/HEAD routes. Returning the entry document here
  // makes direct visits such as /shop and /product/:slug work outside Vercel too.
  webApp.use((request, response, next) => {
    if (!isClientRoute(request)) return apiApp(request, response, next);
    response.setHeader("Cache-Control", "no-cache");
    return response.sendFile(indexPath);
  });

  return webApp;
};
