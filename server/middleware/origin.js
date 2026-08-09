import { env } from "../config/env.js";
import { forbidden } from "../lib/errors.js";

const normalizedHost = (value) => String(value || "").toLowerCase().replace(/\/$/, "");

export const isOriginAllowed = (request, origin = request.get("origin")) => {
  if (!origin) return true;
  const normalizedOrigin = normalizedHost(origin);
  if (env.clientOrigins.includes(normalizedOrigin)) return true;
  try {
    return new URL(normalizedOrigin).host === normalizedHost(request.get("host"));
  } catch {
    return false;
  }
};

export const requireTrustedOrigin = (request, _response, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method) || isOriginAllowed(request)) return next();
  return next(forbidden("This request origin is not allowed"));
};
