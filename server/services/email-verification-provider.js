import { emailAuthStatus, env } from "../config/env.js";
import { AppError, configurationError, rateLimited } from "../lib/errors.js";

let providerFetch = (...args) => fetch(...args);

const resendProvider = {
  async send({ email, code, expiresInMinutes }) {
    if (!emailAuthStatus().configured) {
      throw configurationError(["RESEND_API_KEY", "AUTH_EMAIL_FROM", "EMAIL_OTP_SECRET"]);
    }
    let response;
    try {
      response = await providerFetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: env.authEmailFrom,
          to: [email],
          ...(env.authEmailReplyTo ? { reply_to: env.authEmailReplyTo } : {}),
          subject: "Your Gift N Wrap verification code",
          text: `Your Gift N Wrap verification code is ${code}. It expires in ${expiresInMinutes} minutes. If you did not request this code, you can ignore this email.`,
          html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#173f35"><p>Your Gift N Wrap verification code is:</p><p style="font-size:30px;font-weight:700;letter-spacing:8px">${code}</p><p>It expires in ${expiresInMinutes} minutes. If you did not request this code, you can ignore this email.</p></div>`,
        }),
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      throw new AppError(
        502,
        "EMAIL_DELIVERY_UNAVAILABLE",
        "Verification email is temporarily unavailable. Please try again",
      );
    }
    const payload = await response.json().catch(() => ({}));
    if (response.ok && payload.id) return true;
    if (response.status === 429) {
      throw rateLimited("Too many verification emails. Please wait before trying again");
    }
    if ([401, 403, 422].includes(response.status)) {
      throw configurationError(["Resend verification sender"]);
    }
    throw new AppError(
      502,
      "EMAIL_DELIVERY_UNAVAILABLE",
      "Verification email is temporarily unavailable. Please try again",
    );
  },
};

const demoProvider = {
  async send() {
    return true;
  },
};

let testProvider;

export const emailVerificationProvider = () => {
  if (testProvider) return testProvider;
  return emailAuthStatus().demo ? demoProvider : resendProvider;
};

export const setEmailVerificationProviderForTests = (provider) => {
  if (!env.isTest) throw new Error("Email verification test providers are test-only");
  testProvider = provider;
};

export const setEmailProviderFetchForTests = (implementation) => {
  if (!env.isTest) throw new Error("Email provider fetch test doubles are test-only");
  providerFetch = implementation;
};

export const resetEmailVerificationProviderForTests = () => {
  if (!env.isTest) throw new Error("Email verification reset is test-only");
  testProvider = undefined;
  providerFetch = (...args) => fetch(...args);
};
