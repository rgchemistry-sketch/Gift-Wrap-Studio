import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { phoneAuthStatus } from "../config/env.js";
import { asyncHandler } from "../lib/async-handler.js";
import { rateLimitHandler } from "../middleware/rate-limit.js";
import { validate } from "../middleware/validate.js";
import { publicUser, sessionCookieOptions, signSession } from "../services/auth.js";
import {
  startPhoneAuthentication,
  verifyPhoneAuthentication,
} from "../services/phone-auth.js";
import { startPhoneAuthSchema, verifyPhoneAuthSchema } from "../validation/phone-auth.js";
import { env } from "../config/env.js";

export const phoneAuthRouter = Router();

const limiter = (limit, message) =>
  rateLimit({
    windowMs: 15 * 60 * 1_000,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip: () => env.isTest,
    handler: rateLimitHandler(message),
  });

phoneAuthRouter.get("/status", (_request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.json({ data: phoneAuthStatus() });
});

phoneAuthRouter.post(
  "/start",
  limiter(5, "Too many verification requests. Please wait before trying again"),
  validate({ body: startPhoneAuthSchema }),
  asyncHandler(async (request, response) => {
    const result = await startPhoneAuthentication(request.validated.body);
    response.json({ data: result });
  }),
);

phoneAuthRouter.post(
  "/verify",
  limiter(10, "Too many code attempts. Request a new verification code"),
  validate({ body: verifyPhoneAuthSchema }),
  asyncHandler(async (request, response) => {
    const user = await verifyPhoneAuthentication(request.validated.body);
    response.cookie(env.cookieName, signSession(user), sessionCookieOptions());
    response.json({ data: { user: publicUser(user) } });
  }),
);
