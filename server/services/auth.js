import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { configurationError, unauthorized } from "../lib/errors.js";

let googleClient;

const requireJwtConfig = () => {
  if (!env.jwtSecret) throw configurationError(["JWT_SECRET"]);
  if (env.isProduction && env.jwtSecret.length < 32) {
    throw configurationError(["JWT_SECRET (must be at least 32 characters in production)"]);
  }
};

export const verifyGoogleCredential = async (credential) => {
  if (!env.googleClientId) throw configurationError(["GOOGLE_CLIENT_ID"]);
  googleClient ||= new OAuth2Client(env.googleClientId);

  let ticket;
  try {
    ticket = await googleClient.verifyIdToken({ idToken: credential, audience: env.googleClientId });
  } catch {
    throw unauthorized("Google could not verify this sign-in");
  }

  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email || payload.email_verified !== true) {
    throw unauthorized("A verified Google account is required");
  }

  return {
    googleSub: payload.sub,
    email: payload.email.toLowerCase(),
    name: payload.name?.trim() || payload.email.split("@")[0],
    avatar: payload.picture || "",
  };
};

export const signSession = (user) => {
  requireJwtConfig();
  return jwt.sign(
    { email: user.email, name: user.name, avatar: user.avatar || "" },
    env.jwtSecret,
    {
      subject: user.id,
      expiresIn: env.jwtExpiresIn,
      issuer: env.jwtIssuer,
      audience: "gift-n-wrap-web",
      algorithm: "HS256",
    },
  );
};

export const verifySession = (token) => {
  requireJwtConfig();
  try {
    return jwt.verify(token, env.jwtSecret, {
      issuer: env.jwtIssuer,
      audience: "gift-n-wrap-web",
      algorithms: ["HS256"],
    });
  } catch {
    throw unauthorized("Your session has expired. Please sign in again");
  }
};

export const sessionCookieOptions = ({ clear = false } = {}) => ({
  httpOnly: true,
  secure: env.isProduction || env.cookieSameSite === "none",
  sameSite: env.cookieSameSite,
  path: "/",
  ...(clear ? {} : { maxAge: env.cookieDays * 24 * 60 * 60 * 1_000 }),
});

export const publicUser = (user) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  avatar: user.avatar || "",
  role: user.role,
  phoneMasked: user.phone ? `+91 •••••• ${user.phone.slice(-4)}` : "",
  phoneVerified: Boolean(user.phoneVerifiedAt),
});
