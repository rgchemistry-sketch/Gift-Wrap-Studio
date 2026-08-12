import { Router } from "express";
import { asyncHandler } from "../lib/async-handler.js";
import { optionalAuth } from "../middleware/auth.js";
import { getStudioSettings, listBuyerOrders } from "../services/store.js";

export const offersRouter = Router();

offersRouter.get(
  "/welcome",
  optionalAuth,
  asyncHandler(async (request, response) => {
    const settings = await getStudioSettings();
    const eligible =
      settings.offer.enabled &&
      (request.user
        ? (await listBuyerOrders(request.user.id, { page: 1, limit: 1 })).total === 0
        : true);
    response.setHeader("Cache-Control", "no-store");
    response.json({
      data: {
        enabled: settings.offer.enabled,
        code: settings.offer.code,
        percent: settings.offer.percent,
        maxDiscount: settings.offer.maxDiscount,
        bulkOrderThreshold: settings.shipping.bulkThreshold,
        currency: "INR",
        firstOrderOnly: true,
        eligible,
        popup: { ...settings.offer },
      },
    });
  }),
);
