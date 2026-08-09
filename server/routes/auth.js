import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { env } from "../config/env.js";
import { asyncHandler } from "../lib/async-handler.js";
import { authenticate } from "../middleware/auth.js";
import { rateLimitHandler } from "../middleware/rate-limit.js";
import { validate } from "../middleware/validate.js";
import {
  publicUser,
  sessionCookieOptions,
  signSession,
  verifyGoogleCredential,
} from "../services/auth.js";
import { upsertGoogleUser } from "../services/store.js";
import { demoLoginSchema, googleLoginSchema } from "../validation/schemas.js";

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1_000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: () => env.isTest,
  handler: rateLimitHandler("Too many sign-in attempts. Please try again later"),
});

authRouter.post(
  "/google",
  loginLimiter,
  validate({ body: googleLoginSchema }),
  asyncHandler(async (request, response) => {
    const credential = request.validated.body.credential || request.validated.body.idToken;
    const profile = await verifyGoogleCredential(credential);
    const user = await upsertGoogleUser(profile);
    response.cookie(env.cookieName, signSession(user), sessionCookieOptions());
    response.json({ data: { user: publicUser(user) } });
  }),
);

if (env.allowDemoAuth) {
  authRouter.post(
    "/demo",
    loginLimiter,
    validate({ body: demoLoginSchema }),
    asyncHandler(async (request, response) => {
      const isAdmin = request.validated.body.role === "admin";
      const profile = {
        googleSub: isAdmin ? "local-demo-admin" : "local-demo-buyer",
        email: isAdmin ? env.adminEmail : "buyer@giftnwrap.local",
        name: isAdmin ? "Gift N Wrap Admin" : "Demo Buyer",
        avatar: "",
      };
      const user = await upsertGoogleUser(profile);
      response.cookie(env.cookieName, signSession(user), sessionCookieOptions());
      response.json({ data: { user: publicUser(user), demo: true } });
    }),
  );
}

authRouter.get(
  "/me",
  authenticate,
  asyncHandler(async (request, response) => {
    response.json({ data: { user: publicUser(request.user) } });
  }),
);

authRouter.post("/logout", (request, response) => {
  response.clearCookie(env.cookieName, sessionCookieOptions({ clear: true }));
  response.json({ data: { success: true } });
});
