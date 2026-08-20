import { emailAuthStatus, env } from "../config/env.js";
import { configurationError } from "../lib/errors.js";
import {
  renderBrandedEmail,
  resetEmailProviderForTests,
  sendEmail,
  setEmailProviderFetchForTests as setSharedEmailProviderFetchForTests,
} from "./email.js";

const resendProvider = {
  async send({ email, code, expiresInMinutes }) {
    if (!emailAuthStatus().configured) {
      throw configurationError(["RESEND_API_KEY", "AUTH_EMAIL_FROM", "EMAIL_OTP_SECRET"]);
    }
    const content = renderBrandedEmail(
      {
        eyebrow: "Secure sign in",
        title: "Your verification code",
        preheader: `Use ${code} to continue securely.`,
        bodyHtml: `<p style="margin:0 0 14px">Use this one-time code to continue securely:</p><p style="margin:18px 0 22px;font-family:Arial,sans-serif;font-size:32px;font-weight:700;letter-spacing:8px;color:#6d1f35">${code}</p><p style="margin:0">It expires in ${expiresInMinutes} minutes. If you did not request this code, you can ignore this email.</p>`,
        bodyText: `Your Gift N Wrap verification code is ${code}.\n\nIt expires in ${expiresInMinutes} minutes. If you did not request this code, you can ignore this email.`,
      },
    );
    await sendEmail({
      to: email,
      subject: "Your Gift N Wrap verification code",
      replyTo: env.authEmailReplyTo,
      ...content,
    });
    return true;
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
  setSharedEmailProviderFetchForTests(implementation);
};

export const resetEmailVerificationProviderForTests = () => {
  if (!env.isTest) throw new Error("Email verification reset is test-only");
  testProvider = undefined;
  resetEmailProviderForTests();
};
