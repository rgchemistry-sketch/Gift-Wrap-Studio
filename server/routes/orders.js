import { Router } from "express";
import { asyncHandler } from "../lib/async-handler.js";
import { badRequest, forbidden } from "../lib/errors.js";
import { authenticate, requireExpectedUser } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { createOrder, getOrder, listBuyerOrders } from "../services/store.js";
import { createOrderSchema, idParamsSchema, orderQuerySchema } from "../validation/schemas.js";

export const ordersRouter = Router();
ordersRouter.use(authenticate);

ordersRouter.post(
  "/",
  requireExpectedUser,
  validate({ body: createOrderSchema }),
  asyncHandler(async (request, response) => {
    const idempotencyKey = request.get("idempotency-key")?.trim() || "";
    if (idempotencyKey && !/^[A-Za-z0-9._:-]{8,100}$/.test(idempotencyKey)) {
      throw badRequest("Idempotency-Key must be 8-100 safe characters");
    }
    const result = await createOrder(request.user, request.validated.body, { idempotencyKey });
    if (result.replayed) response.setHeader("Idempotency-Replayed", "true");
    response.status(result.replayed ? 200 : 201).json({ data: result.order });
  }),
);

ordersRouter.get(
  "/my",
  validate({ query: orderQuerySchema }),
  asyncHandler(async (request, response) => {
    const result = await listBuyerOrders(request.user.id, request.validated.query);
    response.json({
      data: result.items,
      meta: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: result.totalPages,
      },
    });
  }),
);

ordersRouter.get(
  "/:id",
  validate({ params: idParamsSchema }),
  asyncHandler(async (request, response) => {
    const order = await getOrder(request.validated.params.id);
    if (order.buyerId !== request.user.id && request.user.role !== "admin") throw forbidden();
    response.json({ data: order });
  }),
);
