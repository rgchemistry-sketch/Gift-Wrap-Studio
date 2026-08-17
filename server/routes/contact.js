import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { env } from "../config/env.js";
import { asyncHandler } from "../lib/async-handler.js";
import { authenticate, requireExpectedUser } from "../middleware/auth.js";
import { rateLimitHandler } from "../middleware/rate-limit.js";
import { validate } from "../middleware/validate.js";
import { createContact } from "../services/store.js";
import { contactSchema } from "../validation/schemas.js";

export const contactRouter = Router();

const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1_000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: () => env.isTest,
  handler: rateLimitHandler("Too many messages. Please try again later"),
});

contactRouter.post(
  "/",
  authenticate,
  requireExpectedUser,
  contactLimiter,
  validate({ body: contactSchema }),
  asyncHandler(async (request, response) => {
    const message = await createContact(request.validated.body, request.user);
    response.status(201).json({
      data: {
        id: message.id,
        status: message.status,
        createdAt: message.createdAt,
        message: "Thanks for reaching out. We will get back to you soon.",
      },
    });
  }),
);
