import { env } from "../config/env.js";
import { unauthorized } from "../lib/errors.js";
import { verifyGoogleCredential } from "./auth.js";

const testVerifiers = new Map();

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

export const verifySocialIdentity = async (provider, input) => {
  const override = testVerifiers.get(provider);
  if (override) return override(input);
  if (provider === "google") return verifyGoogle(input);
  throw unauthorized("That sign-in provider is not supported");
};

export const setSocialIdentityVerifierForTests = (provider, verifier) => {
  if (!env.isTest) throw new Error("Social identity test doubles are test-only");
  testVerifiers.set(provider, verifier);
};

export const resetSocialAuthForTests = () => {
  if (!env.isTest) throw new Error("Social authentication reset is test-only");
  testVerifiers.clear();
};
