import { Router } from "express";
import { asyncHandler } from "../lib/async-handler.js";
import { optionalAuth } from "../middleware/auth.js";
import { buyerHasOrders, getStudioSettings } from "../services/store.js";

export const offersRouter = Router();

offersRouter.get(
  "/welcome",
  optionalAuth,
  asyncHandler(async (request, response) => {
    // Settings and the indexed existence check are independent. Running them
    // together removes one database round trip from signed-in storefront loads.
    const [settings, buyerHasPlacedOrder] = await Promise.all([
      getStudioSettings(),
      request.user ? buyerHasOrders(request.user.id) : false,
    ]);
    const eligible = settings.offer.enabled && !buyerHasPlacedOrder;
    response.setHeader("Cache-Control", "no-store");
    response.vary("Cookie");
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
        viewer: {
          authenticated: Boolean(request.user),
          id: request.user?.id || "",
        },
        popup: { ...settings.offer },
      },
    });
  }),
);
