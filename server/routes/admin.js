import { Router } from "express";
import { asyncHandler } from "../lib/async-handler.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  archiveProduct,
  createProduct,
  getDashboardStats,
  getProductForAdmin,
  getRegisteredUserDetail,
  getRegisteredUserMetrics,
  getStudioSettings,
  listAllOrders,
  listAllProductsForAdmin,
  listContacts,
  listCustomInquiries,
  listRegisteredUsers,
  updateContact,
  updateCustomInquiry,
  updateOrderStatus,
  updateProduct,
  updateStudioSettings,
} from "../services/store.js";
import {
  adminProductQuerySchema,
  adminUserQuerySchema,
  contactStatusSchema,
  createProductSchema,
  idParamsSchema,
  inboxQuerySchema,
  inquiryStatusSchema,
  orderQuerySchema,
  orderStatusSchema,
  studioSettingsSchema,
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
  validate({ query: adminProductQuerySchema }),
  asyncHandler(async (request, response) => {
    const result = await listAllProductsForAdmin(request.validated.query);
    const pagination = {
      page: result.page,
      limit: result.limit,
      total: result.total,
      pages: result.totalPages,
      totalPages: result.totalPages,
    };
    response.json({
      data: result.items,
      pagination,
      meta: pagination,
    });
  }),
);

adminRouter.post(
  "/products",
  validate({ body: createProductSchema }),
  asyncHandler(async (request, response) => {
    response.status(201).json({
      data: await createProduct(request.validated.body, { userId: request.user.id }),
    });
  }),
);

adminRouter.get(
  "/products/:id",
  validate({ params: idParamsSchema }),
  asyncHandler(async (request, response) => {
    response.json({ data: await getProductForAdmin(request.validated.params.id) });
  }),
);

adminRouter.patch(
  "/products/:id",
  validate({ params: idParamsSchema, body: updateProductSchema }),
  asyncHandler(async (request, response) => {
    response.json({
      data: await updateProduct(request.validated.params.id, request.validated.body, {
        userId: request.user.id,
      }),
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
  "/settings",
  asyncHandler(async (_request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.json({ data: await getStudioSettings() });
  }),
);

adminRouter.put(
  "/settings",
  validate({ body: studioSettingsSchema }),
  asyncHandler(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.json({
      data: await updateStudioSettings(request.validated.body, request.user.email),
    });
  }),
);

adminRouter.get(
  "/users",
  validate({ query: adminUserQuerySchema }),
  asyncHandler(async (request, response) => {
    const [result, metrics] = await Promise.all([
      listRegisteredUsers(request.validated.query),
      getRegisteredUserMetrics(undefined, { includeRepeatCustomers: false }),
    ]);
    response.json({
      data: result.items,
      metrics,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        pages: result.totalPages,
        totalPages: result.totalPages,
      },
      meta: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: result.totalPages,
        metrics,
      },
    });
  }),
);

adminRouter.get(
  "/users/metrics",
  asyncHandler(async (_request, response) => {
    response.json({ data: await getRegisteredUserMetrics() });
  }),
);

adminRouter.get(
  "/users/:id",
  validate({ params: idParamsSchema }),
  asyncHandler(async (request, response) => {
    response.json({ data: await getRegisteredUserDetail(request.validated.params.id) });
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
