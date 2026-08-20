import { emailAuthStatus, env } from "../config/env.js";
import { AppError, configurationError, rateLimited } from "../lib/errors.js";

let providerFetch = (...args) => fetch(...args);
let warnedAboutMissingConfiguration = false;

const recipientList = (value) =>
  [...new Set((Array.isArray(value) ? value : [value]).map((entry) => String(entry || "").trim()).filter(Boolean))];

const providerFailure = (response, payload) => ({
  status: response.status,
  code: String(payload?.name || payload?.code || "unknown"),
  message: String(payload?.message || payload?.error || "No provider message").slice(0, 300),
});

export const escapeEmailHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export const emailDeliveryConfigured = () =>
  Boolean(env.resendApiKey && env.authEmailFrom);

export const sendEmail = async ({ to, subject, html, text, replyTo }) => {
  if (!emailDeliveryConfigured()) {
    throw configurationError(["RESEND_API_KEY", "AUTH_EMAIL_FROM"]);
  }

  const recipients = recipientList(to);
  if (!recipients.length) throw new TypeError("At least one email recipient is required");

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
        to: recipients,
        ...(replyTo || env.authEmailReplyTo
          ? { reply_to: replyTo || env.authEmailReplyTo }
          : {}),
        subject,
        text,
        html,
      }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch (error) {
    console.error("[email] Resend request failed", {
      error: error?.name || "Error",
      message: String(error?.message || "Network request failed").slice(0, 200),
    });
    throw new AppError(
      502,
      "EMAIL_DELIVERY_UNAVAILABLE",
      "Email delivery is temporarily unavailable. Please try again",
    );
  }

  const payload = await response.json().catch(() => ({}));
  if (response.ok && payload.id) {
    console.info(`[email] Resend accepted message ${payload.id}`);
    return { id: payload.id };
  }

  console.error("[email] Resend rejected message", providerFailure(response, payload));
  if (response.status === 429) {
    throw rateLimited("Too many emails were requested. Please wait before trying again");
  }
  if ([401, 403, 422].includes(response.status)) {
    throw configurationError(["Resend sender configuration"]);
  }
  throw new AppError(
    502,
    "EMAIL_DELIVERY_UNAVAILABLE",
    "Email delivery is temporarily unavailable. Please try again",
  );
};

export const sendEmailSafely = async (message, context = "transactional email") => {
  if (!emailDeliveryConfigured()) {
    if (!env.isTest && !warnedAboutMissingConfiguration) {
      warnedAboutMissingConfiguration = true;
      console.warn(
        "[email] Transactional email is disabled because RESEND_API_KEY or AUTH_EMAIL_FROM is missing",
      );
    }
    return { sent: false, skipped: true };
  }
  try {
    const result = await sendEmail(message);
    return { sent: true, id: result.id };
  } catch (error) {
    console.error(`[email] Could not send ${context}`, {
      code: error?.code || "EMAIL_DELIVERY_FAILED",
      status: error?.status || 500,
      message: String(error?.message || "Unknown email failure").slice(0, 240),
    });
    return { sent: false, error: error?.code || "EMAIL_DELIVERY_FAILED" };
  }
};

const contactFooter = (settings = {}) => {
  const contact = settings.contact || {};
  return [contact.email, contact.phone, contact.instagramHandle || contact.instagram]
    .filter(Boolean)
    .join(" · ");
};

export const renderBrandedEmail = (
  { eyebrow = "Gift N Wrap Studio", title, preheader = "", bodyHtml, bodyText },
  settings = {},
) => {
  const footer = contactFooter(settings);
  const safePreheader = escapeEmailHtml(preheader || title);
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f4efe6;color:#173f35;font-family:Georgia,'Times New Roman',serif">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${safePreheader}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4efe6;padding:28px 14px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#fffdf8;border:1px solid #dccfbe;border-radius:18px;overflow:hidden">
        <tr><td style="background:#173f35;padding:24px 34px;color:#fffdf8">
          <div style="font-family:Arial,sans-serif;font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#d9c4a7">${escapeEmailHtml(eyebrow)}</div>
          <div style="font-size:29px;line-height:1.2;margin-top:10px">${escapeEmailHtml(title)}</div>
        </td></tr>
        <tr><td style="padding:32px 34px;font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#294c43">${bodyHtml}</td></tr>
        <tr><td style="border-top:1px solid #eadfd1;padding:20px 34px;font-family:Arial,sans-serif;font-size:12px;line-height:1.6;color:#6d706a">
          <strong style="color:#6d1f35">Gift N Wrap Studio</strong><br>
          ${footer ? escapeEmailHtml(footer) : "Handmade resin art and personalized gifts"}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  const text = `${title}\n${"=".repeat(Math.min(60, title.length))}\n\n${bodyText}\n\nGift N Wrap Studio${footer ? `\n${footer}` : ""}`;
  return { html, text };
};

export const setEmailProviderFetchForTests = (implementation) => {
  if (!env.isTest) throw new Error("Email provider fetch test doubles are test-only");
  providerFetch = implementation;
};

export const resetEmailProviderForTests = () => {
  if (!env.isTest) throw new Error("Email provider reset is test-only");
  providerFetch = (...args) => fetch(...args);
  warnedAboutMissingConfiguration = false;
};

export const verificationEmailEnabled = () => emailAuthStatus().configured;
