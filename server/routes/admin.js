import { Router } from "express";
import { asyncHandler } from "../lib/async-handler.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  archiveProduct,
  createProduct,
  getDashboardStats,
  listAllOrders,
  listAllProductsForAdmin,
  listContacts,
  listCustomInquiries,
  updateContact,
  updateCustomInquiry,
  updateOrderStatus,
  updateProduct,
} from "../services/store.js";
import {
  contactStatusSchema,
  createProductSchema,
  idParamsSchema,
  inboxQuerySchema,
  inquiryStatusSchema,
  orderQuerySchema,
  orderStatusSchema,
  updateProductSchema,
} from "../validation/schemas.js";

export const adminRouter = Router();
adminRouter.use(authenticate, requireAdmin);

adminRouter.get(
  "/dashboard",
  asyncHandler(async (_request, response) => {
    response.json({ data: await getDashboardStats() });
  }),
);

adminRouter.get(
  "/products",
  asyncHandler(async (_request, response) => {
    response.json({ data: await listAllProductsForAdmin() });
  }),
);

adminRouter.post(
  "/products",
  validate({ body: createProductSchema }),
  asyncHandler(async (request, response) => {
    response.status(201).json({ data: await createProduct(request.validated.body) });
  }),
);

adminRouter.patch(
  "/products/:id",
  validate({ params: idParamsSchema, body: updateProductSchema }),
  asyncHandler(async (request, response) => {
    response.json({
      data: await updateProduct(request.validated.params.id, request.validated.body),
    });
  }),
);

adminRouter.delete(
  "/products/:id",
  validate({ params: idParamsSchema }),
  asyncHandler(async (request, response) => {
    response.json({ data: await archiveProduct(request.validated.params.id) });
  }),
);

adminRouter.get(
  "/orders",
  validate({ query: orderQuerySchema }),
  asyncHandler(async (request, response) => {
    const result = await listAllOrders(request.validated.query);
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

adminRouter.patch(
  "/orders/:id/status",
  validate({ params: idParamsSchema, body: orderStatusSchema }),
  asyncHandler(async (request, response) => {
    response.json({
      data: await updateOrderStatus(request.validated.params.id, request.validated.body),
    });
  }),
);

adminRouter.get(
  "/custom-inquiries",
  validate({ query: inboxQuerySchema }),
  asyncHandler(async (request, response) => {
    const result = await listCustomInquiries(request.validated.query);
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

adminRouter.patch(
  "/custom-inquiries/:id",
  validate({ params: idParamsSchema, body: inquiryStatusSchema }),
  asyncHandler(async (request, response) => {
    response.json({
      data: await updateCustomInquiry(request.validated.params.id, request.validated.body),
    });
  }),
);

adminRouter.get(
  "/contacts",
  validate({ query: inboxQuerySchema }),
  asyncHandler(async (request, response) => {
    const result = await listContacts(request.validated.query);
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

adminRouter.patch(
  "/contacts/:id",
  validate({ params: idParamsSchema, body: contactStatusSchema }),
  asyncHandler(async (request, response) => {
    response.json({ data: await updateContact(request.validated.params.id, request.validated.body) });
  }),
);
