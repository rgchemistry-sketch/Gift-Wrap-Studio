import { env, phoneAuthStatus } from "../config/env.js";
import { AppError, badRequest, configurationError, rateLimited } from "../lib/errors.js";

const endpoint = () =>
  `https://verify.twilio.com/v2/Services/${encodeURIComponent(env.twilioVerifyServiceSid)}`;

const authorization = () => {
  const username = env.twilioApiKeySid || env.twilioAccountSid;
  const password = env.twilioApiKeySecret || env.twilioAuthToken;
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
};

const callVerify = async (path, fields) => {
  if (!phoneAuthStatus().configured) {
    throw configurationError(["phone verification provider"]);
  }

  let response;
  try {
    response = await fetch(`${endpoint()}${path}`, {
      method: "POST",
      headers: {
        Authorization: authorization(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(fields),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new AppError(
      502,
      "PHONE_VERIFICATION_UNAVAILABLE",
      "Phone verification is temporarily unavailable. Please try again",
    );
  }

  const payload = await response.json().catch(() => ({}));
  if (response.ok) return payload;
  if (response.status === 429 || payload.code === 60203 || payload.code === 60245) {
    throw rateLimited("Too many verification requests. Please wait before trying again");
  }
  if ([401, 403].includes(response.status)) {
    throw configurationError(["phone verification provider"]);
  }
  if (response.status === 400 && path === "/Verifications") {
    throw badRequest("That mobile number could not receive a verification SMS");
  }
  if ([400, 404].includes(response.status) && path === "/VerificationCheck") {
    return { status: "pending" };
  }
  throw new AppError(
    502,
    "PHONE_VERIFICATION_UNAVAILABLE",
    "Phone verification is temporarily unavailable. Please try again",
  );
};

const twilioProvider = {
  async start(phone) {
    const result = await callVerify("/Verifications", { To: phone, Channel: "sms" });
    return result.status === "pending";
  },
  async check(phone, code) {
    const result = await callVerify("/VerificationCheck", { To: phone, Code: code });
    return result.status === "approved";
  },
};

let testProvider;

export const phoneVerificationProvider = () => testProvider || twilioProvider;

export const setPhoneVerificationProviderForTests = (provider) => {
  if (!env.isTest) throw new Error("Phone verification test providers are test-only");
  testProvider = provider;
};
