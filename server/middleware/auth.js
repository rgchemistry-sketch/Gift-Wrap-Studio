import { databaseStatus } from "../config/database.js";
import { env } from "../config/env.js";
import { asyncHandler } from "../lib/async-handler.js";
import {
  configurationError,
  databaseUnavailable,
  forbidden,
  sessionIdentityChanged,
  unauthorized,
} from "../lib/errors.js";
import { sessionCookieOptions, verifySession } from "../services/auth.js";
import { getUserById } from "../services/store.js";

const tokenFromRequest = (request) => {
  const cookieToken = request.cookies?.[env.cookieName];
  if (cookieToken) return cookieToken;
  const authorization = request.get("authorization");
  return authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
};

export const hasAdminAccess = (user) => {
  const email = String(user?.email || "").toLowerCase();
  const providers = Array.isArray(user?.providers) ? user.providers : [];
  const configuredAdmin = Boolean(env.adminEmail && email === env.adminEmail);
  const previewAdmin = Boolean(
    env.allowDemoAuth
      && email === "preview-admin@giftnwrap.local"
      && user?.role === "admin"
      && providers.includes("demo"),
  );
  return configuredAdmin || previewAdmin;
};

const resolveUser = async (request, { required }) => {
  const token = tokenFromRequest(request);
  if (!token) {
    if (required) throw unauthorized();
    return;
  }

  const payload = verifySession(token);
  const storedUser = await getUserById(payload.sub);
  const persistence = databaseStatus();
  if (persistence.mode === "memory" && !env.allowMemoryWrites) throw databaseUnavailable();
  if (!storedUser) throw unauthorized();
  if (Number(payload.ver || 0) !== Number(storedUser.sessionVersion || 0)) {
    throw unauthorized("Your session has been signed out. Please sign in again");
  }

  const email = (storedUser?.email || payload.email || "").toLowerCase();
  if (!email) throw unauthorized();
  const providers =
    storedUser.providers?.length > 0
      ? storedUser.providers
      : storedUser.googleSub
        ? ["google"]
        : [];
  // ADMIN_EMAIL remains the production source of truth. The only exception is the
  // isolated preview identity while non-production demo auth is explicitly enabled.
  const role = hasAdminAccess({ ...storedUser, email, providers }) ? "admin" : "buyer";
  request.user = {
    id: storedUser?.id || payload.sub,
    email,
    name: storedUser?.name || payload.name || email.split("@")[0],
    avatar: storedUser?.avatar || payload.avatar || "",
    role,
    emailVerifiedAt: storedUser.emailVerifiedAt || (storedUser.googleSub ? new Date(0) : null),
    providers,
    sessionVersion: Number(storedUser.sessionVersion || 0),
    googleSub: storedUser.googleSub || "",
    phone: storedUser?.phone || "",
    phoneVerifiedAt: storedUser?.phoneVerifiedAt || null,
  };
};

export const optionalAuth = asyncHandler(async (request, _response, next) => {
  try {
    await resolveUser(request, { required: false });
    next();
  } catch (error) {
    if (error?.code !== "UNAUTHORIZED") throw error;
    _response.clearCookie(env.cookieName, sessionCookieOptions({ clear: true }));
    next();
  }
});

export const authenticate = asyncHandler(async (request, response, next) => {
  try {
    await resolveUser(request, { required: true });
    next();
  } catch (error) {
    if (error?.code === "UNAUTHORIZED") {
      response.clearCookie(env.cookieName, sessionCookieOptions({ clear: true }));
    }
    throw error;
  }
});

export const requireAdmin = (request, _response, next) => {
  if (!env.adminEmail && !env.allowDemoAuth) return next(configurationError(["ADMIN_EMAIL"]));
  if (!hasAdminAccess(request.user)) {
    return next(forbidden("Administrator access required"));
  }
  return next();
};

export const requireExpectedUser = (request, _response, next) => {
  const expectedUserId = request.get("x-expected-user-id")?.trim();
  if (expectedUserId && expectedUserId !== String(request.user?.id || "")) {
    return next(sessionIdentityChanged());
  }
  return next();
};
