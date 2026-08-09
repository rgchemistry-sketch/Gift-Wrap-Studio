import { Router } from "express";
import { env } from "../config/env.js";
import { asyncHandler } from "../lib/async-handler.js";
import { optionalAuth } from "../middleware/auth.js";
import { listBuyerOrders } from "../services/store.js";

export const offersRouter = Router();

offersRouter.get(
  "/welcome",
  optionalAuth,
  asyncHandler(async (request, response) => {
    const eligible = request.user
      ? (await listBuyerOrders(request.user.id, { page: 1, limit: 1 })).total === 0
      : true;
    response.json({
      data: {
        code: env.welcomeCouponCode,
        percent: env.welcomeDiscountPercent,
        maxDiscount: env.welcomeDiscountMax,
        currency: "INR",
        firstOrderOnly: true,
        eligible,
      },
    });
  }),
);
