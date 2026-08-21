import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { env } from "../config/env.js";
import { asyncHandler } from "../lib/async-handler.js";
import { DurableRateLimitStore } from "../middleware/durable-rate-limit.js";
import { authenticate, requireExpectedUser } from "../middleware/auth.js";
import { rateLimitHandler } from "../middleware/rate-limit.js";
import { validate } from "../middleware/validate.js";
import {
  createProductReview,
  getPublicProductReviews,
  listEligibleReviewProducts,
  listOwnProductReviews,
  updateOwnProductReview,
} from "../services/product-reviews.js";
import {
  createReviewSchema,
  publicReviewQuerySchema,
  reviewParamsSchema,
  updateReviewSchema,
} from "../validation/schemas.js";

export const reviewsRouter = Router();

const publicReviewLimiter = rateLimit({
  windowMs: 15 * 60 * 1_000,
  // This read powers every homepage visit, including families and offices that
  // share one public IP. Keep abuse bounded without hiding reviews from them.
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: () => env.isTest,
  store: new DurableRateLimitStore("product-reviews-public"),
  passOnStoreError: !env.isProduction,
  handler: rateLimitHandler("Too many review refreshes. Please try again shortly"),
});

const reviewWriteLimiter = rateLimit({
  windowMs: 60 * 60 * 1_000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: () => env.isTest,
  store: new DurableRateLimitStore("product-reviews-write"),
  passOnStoreError: !env.isProduction,
  handler: rateLimitHandler("Too many review changes. Please try again later"),
});

reviewsRouter.get(
  "/",
  publicReviewLimiter,
  validate({ query: publicReviewQuerySchema }),
  asyncHandler(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.json({ data: await getPublicProductReviews(request.validated.query) });
  }),
);

reviewsRouter.get(
  "/mine",
  authenticate,
  asyncHandler(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.json({ data: { reviews: await listOwnProductReviews(request.user.id) } });
  }),
);

reviewsRouter.get(
  "/eligible",
  authenticate,
  asyncHandler(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.json({ data: { products: await listEligibleReviewProducts(request.user.id) } });
  }),
);

reviewsRouter.post(
  "/",
  authenticate,
  reviewWriteLimiter,
  requireExpectedUser,
  validate({ body: createReviewSchema }),
  asyncHandler(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.status(201).json({
      data: await createProductReview(request.user, request.validated.body),
    });
  }),
);

reviewsRouter.patch(
  "/:id",
  authenticate,
  reviewWriteLimiter,
  requireExpectedUser,
  validate({ params: reviewParamsSchema, body: updateReviewSchema }),
  asyncHandler(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.json({
      data: await updateOwnProductReview(
        request.user.id,
        request.validated.params.id,
        request.validated.body,
      ),
    });
  }),
);
