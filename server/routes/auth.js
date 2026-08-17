import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { authProviderStatus, env } from "../config/env.js";
import { asyncHandler } from "../lib/async-handler.js";
import { authenticate } from "../middleware/auth.js";
import { rateLimitHandler } from "../middleware/rate-limit.js";
import { validate } from "../middleware/validate.js";
import {
  publicUser,
  sessionCookieOptions,
  signSession,
  verifySession,
} from "../services/auth.js";
import { startEmailAuthentication, verifyEmailAuthentication } from "../services/email-auth.js";
import { authenticateSocialIdentity } from "../services/identity-auth.js";
import { verifySocialIdentity } from "../services/social-auth.js";
import { getUserById, revokeUserSessions, upsertGoogleUser } from "../services/store.js";
import { cleanupUnconsumedUploadsForUser } from "../services/upload-cleanup.js";
import { demoLoginSchema, googleLoginSchema } from "../validation/schemas.js";
import { emailAuthStartSchema, emailAuthVerifySchema } from "../validation/auth.js";

export const authRouter = Router();

authRouter.use((_request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Pragma", "no-cache");
  next();
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1_000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: () => env.isTest,
  handler: rateLimitHandler("Too many sign-in attempts. Please try again later"),
});

const verificationLimiter = (limit, message) =>
  rateLimit({
    windowMs: 15 * 60 * 1_000,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip: () => env.isTest,
    handler: rateLimitHandler(message),
  });

const issueSession = (response, user) => {
  response.cookie(env.cookieName, signSession(user), sessionCookieOptions());
  response.json({ data: { user: publicUser(user) } });
};

const socialLogin = (provider, schema) => [
  loginLimiter,
  validate({ body: schema }),
  asyncHandler(async (request, response) => {
    const profile = await verifySocialIdentity(provider, request.validated.body);
    const user = await authenticateSocialIdentity(profile, request.validated.body.intent);
    issueSession(response, user);
  }),
];

authRouter.get("/providers", (_request, response) => {
  response.json({ data: { providers: authProviderStatus() } });
});

authRouter.get("/status", (_request, response) => {
  const details = authProviderStatus();
  response.json({
    data: {
      providers: {
        google: details.google.enabled,
        email: details.email.enabled,
      },
      details,
    },
  });
});

authRouter.post(
  "/email/start",
  verificationLimiter(5, "Too many verification requests. Please wait before trying again"),
  validate({ body: emailAuthStartSchema }),
  asyncHandler(async (request, response) => {
    const result = await startEmailAuthentication(request.validated.body);
    response.json({ data: result });
  }),
);

authRouter.post(
  "/email/verify",
  verificationLimiter(10, "Too many code attempts. Request a new verification code"),
  validate({ body: emailAuthVerifySchema }),
  asyncHandler(async (request, response) => {
    const user = await verifyEmailAuthentication(request.validated.body);
    issueSession(response, user);
  }),
);

authRouter.post("/social/google", ...socialLogin("google", googleLoginSchema));

authRouter.post(
  "/google",
  loginLimiter,
  validate({ body: googleLoginSchema }),
  asyncHandler(async (request, response) => {
    const credential = request.validated.body.credential || request.validated.body.idToken;
    const profile = await verifySocialIdentity("google", { credential });
    const user = await authenticateSocialIdentity(profile, request.validated.body.intent);
    issueSession(response, user);
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

authRouter.post(
  "/logout",
  asyncHandler(async (request, response) => {
    response.clearCookie(env.cookieName, sessionCookieOptions({ clear: true }));
    const token = request.cookies?.[env.cookieName]
      || (request.get("authorization")?.startsWith("Bearer ")
        ? request.get("authorization").slice(7).trim()
        : "");
    let sessionPayload;
    try {
      sessionPayload = token ? verifySession(token) : undefined;
    } catch {
      // Clearing an invalid or expired browser session is still a successful logout.
    }
    const userId = sessionPayload?.sub || "";
    let uploadCleanup = { attempted: 0, removed: 0, failed: 0 };
    let sessionsRevoked = false;
    if (userId) {
      try {
        const user = await getUserById(userId);
        const sessionIsCurrent =
          user && Number(sessionPayload.ver || 0) === Number(user.sessionVersion || 0);
        if (sessionIsCurrent) {
          uploadCleanup = await cleanupUnconsumedUploadsForUser(userId);
          if (uploadCleanup.failed) {
            console.warn(
              `[${request.id}] Logout completed with ${uploadCleanup.failed} upload cleanup failure(s)`,
            );
          }
        }
      } catch (error) {
        console.warn(
          `[${request.id}] Logout continued after upload cleanup failed`,
          error?.code || error?.name,
        );
      }
      try {
        await revokeUserSessions(userId);
        sessionsRevoked = true;
      } catch (error) {
        console.warn(`[${request.id}] Local logout completed; global session revocation failed`, error?.code || error?.name);
      }
    }
    response.json({ data: { success: true, sessionsRevoked, uploadCleanup } });
  }),
);
