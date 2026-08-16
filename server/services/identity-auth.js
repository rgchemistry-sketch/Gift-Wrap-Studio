import { env } from "../config/env.js";
import { accountLinkRequired, badRequest, conflict, unauthorized } from "../lib/errors.js";
import {
  createUserWithAuthIdentity,
  getLegacyGoogleUserBySubject,
  getUserByAuthIdentity,
  getUserByEmail,
  linkAuthIdentity,
  touchAuthenticatedUser,
} from "./store.js";

const normalizeProfile = (profile) => ({
  provider: profile.provider,
  subject: String(profile.subject || "").trim(),
  email: String(profile.email || "").trim().toLowerCase(),
  emailVerified: Boolean(profile.emailVerified),
  name: String(profile.name || "").trim(),
  avatar: String(profile.avatar || "").trim(),
});

const touch = (user, profile) =>
  touchAuthenticatedUser(user.id, {
    provider: profile.provider,
    subject: profile.subject,
    providerEmail: profile.email,
    emailVerified: profile.emailVerified,
    name: profile.name,
    avatar: profile.avatar,
  });

export const authenticateSocialIdentity = async (rawProfile, intent) => {
  if (intent !== "login" && intent !== "signup") {
    throw badRequest("Choose whether to log in or create an account");
  }
  const profile = normalizeProfile(rawProfile);
  const existing = await getUserByAuthIdentity(profile.provider, profile.subject);
  if (existing) {
    if (intent === "signup") {
      throw conflict("This account already exists. Choose log in instead");
    }
    return touch(existing, profile);
  }

  // Existing Google accounts stored their stable subject directly on User. Link only
  // that exact subject; never infer a social link merely from a matching email.
  if (profile.provider === "google") {
    const legacy = await getLegacyGoogleUserBySubject(profile.subject);
    if (legacy) {
      if (intent === "signup") {
        throw conflict("This account already exists. Choose log in instead");
      }
      await linkAuthIdentity({
        userId: legacy.id,
        provider: profile.provider,
        subject: profile.subject,
        providerEmail: profile.email,
        emailVerified: profile.emailVerified,
      });
      return touch(legacy, profile);
    }
  }

  if (intent === "login") {
    throw unauthorized("No account is connected to that sign-in. Create an account first");
  }
  if (!profile.email || !profile.emailVerified) {
    throw conflict("Verify an email address before creating this account");
  }

  if (
    env.adminEmail &&
    profile.email === env.adminEmail &&
    !["google", "email"].includes(profile.provider)
  ) {
    throw accountLinkRequired(
      "Use Google or the verification code sent to the administrator email",
    );
  }

  const emailOwner = await getUserByEmail(profile.email);
  if (emailOwner) {
    throw accountLinkRequired(
      "An account already uses this email. Log in with its existing method or verify the email to connect it",
    );
  }

  return createUserWithAuthIdentity(profile);
};

export const authenticateEmailIdentity = async ({ email, name, intent }) => {
  const normalizedEmail = email.trim().toLowerCase();
  const identity = await getUserByAuthIdentity("email", normalizedEmail);
  const emailOwner = identity || (await getUserByEmail(normalizedEmail));

  if (intent === "signup" && emailOwner) {
    throw conflict("This account already exists. Choose log in instead");
  }
  if (intent === "login" && !emailOwner) {
    throw unauthorized("No account uses this email. Create an account first");
  }

  if (!emailOwner) {
    return createUserWithAuthIdentity({
      provider: "email",
      subject: normalizedEmail,
      email: normalizedEmail,
      emailVerified: true,
      name,
      avatar: "",
    });
  }

  if (!identity) {
    await linkAuthIdentity({
      userId: emailOwner.id,
      provider: "email",
      subject: normalizedEmail,
      providerEmail: normalizedEmail,
      emailVerified: true,
    });
  }
  return touchAuthenticatedUser(emailOwner.id, {
    provider: "email",
    subject: normalizedEmail,
    providerEmail: normalizedEmail,
    emailVerified: true,
  });
};
