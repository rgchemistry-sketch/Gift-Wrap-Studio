import { createHash, timingSafeEqual } from "node:crypto";
import { createLocalJWKSet, createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "../config/env.js";
import { AppError, configurationError, unauthorized } from "../lib/errors.js";
import { verifyGoogleCredential } from "./auth.js";

const appleJwksUrl = new URL("https://appleid.apple.com/auth/keys");
const defaultAppleJwks = () => createRemoteJWKSet(appleJwksUrl);
let appleJwks = defaultAppleJwks();
let socialFetch = (...args) => fetch(...args);
const testVerifiers = new Map();

const fetchJson = async (url) => {
  let response;
  try {
    response = await socialFetch(url, { signal: AbortSignal.timeout(8_000) });
  } catch {
    throw new AppError(
      502,
      "IDENTITY_PROVIDER_UNAVAILABLE",
      "The sign-in provider is temporarily unavailable. Please try again",
    );
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw unauthorized("The sign-in provider could not verify this account");
  }
  return payload;
};

const verifyGoogle = async ({ credential, idToken }) => {
  const profile = await verifyGoogleCredential(credential || idToken);
  return {
    provider: "google",
    subject: profile.googleSub,
    email: profile.email,
    emailVerified: true,
    name: profile.name,
    avatar: profile.avatar,
  };
};

export const verifyFacebookAccessToken = async ({ accessToken }) => {
  if (!env.facebookAppId || !env.facebookAppSecret) {
    throw configurationError(["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET"]);
  }
  const base = `https://graph.facebook.com/${encodeURIComponent(env.facebookGraphVersion)}`;
  const debugUrl = new URL(`${base}/debug_token`);
  debugUrl.searchParams.set("input_token", accessToken);
  debugUrl.searchParams.set("access_token", `${env.facebookAppId}|${env.facebookAppSecret}`);
  const debug = (await fetchJson(debugUrl)).data || {};
  const expiresAt = Number(debug.expires_at || 0);
  if (
    debug.is_valid !== true ||
    String(debug.app_id || "") !== env.facebookAppId ||
    !debug.user_id ||
    (expiresAt > 0 && expiresAt * 1_000 <= Date.now())
  ) {
    throw unauthorized("Facebook could not verify this sign-in");
  }

  const profileUrl = new URL(`${base}/me`);
  profileUrl.searchParams.set("fields", "id,name,email,picture.type(large)");
  profileUrl.searchParams.set("access_token", accessToken);
  const profile = await fetchJson(profileUrl);
  if (!profile.id || String(profile.id) !== String(debug.user_id)) {
    throw unauthorized("Facebook could not verify this sign-in");
  }
  const email = String(profile.email || "").trim().toLowerCase();
  return {
    provider: "facebook",
    subject: String(profile.id),
    email,
    // Facebook supplies the account's primary email through an app-authorized,
    // server-validated access token. Matching another local user still never auto-links.
    emailVerified: Boolean(email),
    name: String(profile.name || "").trim(),
    avatar: String(profile.picture?.data?.url || ""),
  };
};

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const safeHashMatch = (left, right) => {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
};

export const verifyAppleIdToken = async ({ idToken, expectedNonceHash, name = "" }) => {
  if (!env.appleClientId) throw configurationError(["APPLE_CLIENT_ID"]);
  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, appleJwks, {
      issuer: "https://appleid.apple.com",
      audience: env.appleClientId,
      algorithms: ["RS256"],
    }));
  } catch {
    throw unauthorized("Apple could not verify this sign-in");
  }
  const tokenNonce = String(payload.nonce || "");
  const nonceMatches =
    tokenNonce &&
    (safeHashMatch(sha256(tokenNonce), expectedNonceHash) ||
      safeHashMatch(tokenNonce, expectedNonceHash));
  if (!payload.sub || !nonceMatches) {
    throw unauthorized("Apple could not verify this sign-in");
  }
  const email = String(payload.email || "").trim().toLowerCase();
  const emailVerified = payload.email_verified === true || payload.email_verified === "true";
  return {
    provider: "apple",
    subject: String(payload.sub),
    email,
    emailVerified: Boolean(email && emailVerified),
    name: String(name || "").trim(),
    avatar: "",
  };
};

export const verifySocialIdentity = async (provider, input) => {
  const override = testVerifiers.get(provider);
  if (override) return override(input);
  if (provider === "google") return verifyGoogle(input);
  if (provider === "facebook") return verifyFacebookAccessToken(input);
  if (provider === "apple") return verifyAppleIdToken(input);
  throw unauthorized("That sign-in provider is not supported");
};

export const setSocialIdentityVerifierForTests = (provider, verifier) => {
  if (!env.isTest) throw new Error("Social identity test doubles are test-only");
  testVerifiers.set(provider, verifier);
};

export const setSocialFetchForTests = (implementation) => {
  if (!env.isTest) throw new Error("Social fetch test doubles are test-only");
  socialFetch = implementation;
};

export const setAppleJwksForTests = (jwks) => {
  if (!env.isTest) throw new Error("Apple key test doubles are test-only");
  appleJwks = createLocalJWKSet(jwks);
};

export const resetSocialAuthForTests = () => {
  if (!env.isTest) throw new Error("Social authentication reset is test-only");
  testVerifiers.clear();
  socialFetch = (...args) => fetch(...args);
  appleJwks = defaultAppleJwks();
};
