import { env } from "../config/env.js";
import { forbidden } from "../lib/errors.js";

const normalizedHost = (value) => String(value || "").toLowerCase().replace(/\/$/, "");

export const isOriginAllowed = (request, origin = request.get("origin")) => {
  if (!origin) return true;
  const normalizedOrigin = normalizedHost(origin);
  if (env.clientOrigins.includes(normalizedOrigin)) return true;
  try {
    const originUrl = new URL(normalizedOrigin);
    if (
      !env.isProduction
      && ["http:", "https:"].includes(originUrl.protocol)
      && ["localhost", "127.0.0.1", "[::1]"].includes(originUrl.hostname)
    ) {
      return true;
    }
    return originUrl.host === normalizedHost(request.get("host"));
  } catch {
    return false;
  }
};

export const requireTrustedOrigin = (request, _response, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method) || isOriginAllowed(request)) return next();
  return next(forbidden("This request origin is not allowed"));
};
