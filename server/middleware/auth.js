import { databaseStatus } from "../config/database.js";
import { env } from "../config/env.js";
import { asyncHandler } from "../lib/async-handler.js";
import {
  configurationError,
  databaseUnavailable,
  forbidden,
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
  // ADMIN_EMAIL is the single source of truth for admin access. The stored role is only a
  // cache refreshed at login, so requiring it too locked out a newly designated admin
  // until they signed out and back in.
  const role = env.adminEmail && email === env.adminEmail ? "admin" : "buyer";
  request.user = {
    id: storedUser?.id || payload.sub,
    email,
    name: storedUser?.name || payload.name || email.split("@")[0],
    avatar: storedUser?.avatar || payload.avatar || "",
    role,
    emailVerifiedAt: storedUser.emailVerifiedAt || (storedUser.googleSub ? new Date(0) : null),
    providers:
      storedUser.providers?.length > 0
        ? storedUser.providers
        : storedUser.googleSub
          ? ["google"]
          : [],
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
  if (!env.adminEmail) return next(configurationError(["ADMIN_EMAIL"]));
  if (request.user?.role !== "admin" || request.user.email !== env.adminEmail) {
    return next(forbidden("Administrator access required"));
  }
  return next();
};
