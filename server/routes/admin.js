import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { env } from "../config/env.js";
import { asyncHandler } from "../lib/async-handler.js";
import { badRequest } from "../lib/errors.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { DurableRateLimitStore } from "../middleware/durable-rate-limit.js";
import { rateLimitHandler } from "../middleware/rate-limit.js";
import { validate } from "../middleware/validate.js";
import {
  createAdminRefund,
  setPaymentQuote,
} from "../services/payments.js";
import {
  sendContactReplyEmail,
  sendInquiryReplyEmail,
  sendOrderStatusEmail,
  sendPaymentQuoteReadyEmail,
  sendRefundUpdateEmail,
} from "../services/email-notifications.js";
import {
  createSalesAnalyticsWorkbook,
  getSalesAnalytics,
} from "../services/sales-analytics.js";
import {
  archiveProduct,
  createProduct,
  getDashboardStats,
  getOrder,
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
  paymentQuoteSchema,
  razorpayRefundSchema,
  salesAnalyticsQuerySchema,
  studioSettingsSchema,
  updateProductSchema,
} from "../validation/schemas.js";

export const adminRouter = Router();
adminRouter.use(authenticate, requireAdmin);

const adminRefundLimiter = rateLimit({
  windowMs: 60 * 60 * 1_000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: () => env.isTest,
  store: new DurableRateLimitStore("admin-razorpay-refund"),
  passOnStoreError: !env.isProduction,
  handler: rateLimitHandler("Too many refund requests. Please review existing refund status first"),
});

const refundIdempotencyKey = (request) => {
  const key = request.get("idempotency-key")?.trim() || "";
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(key)) {
    throw badRequest("Idempotency-Key is required and must contain 10-100 letters, numbers, dashes or underscores");
  }
  return key;
};

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

adminRouter.get(
  "/analytics/export.xlsx",
  validate({ query: salesAnalyticsQuerySchema }),
  asyncHandler(async (request, response) => {
    const report = await createSalesAnalyticsWorkbook(request.validated.query);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    response.setHeader("Content-Disposition", `attachment; filename="${report.filename}"`);
    response.send(report.buffer);
  }),
);

adminRouter.get(
  "/analytics",
  validate({ query: salesAnalyticsQuerySchema }),
  asyncHandler(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.json({ data: await getSalesAnalytics(request.validated.query) });
  }),
);

adminRouter.get(
  "/orders/:id",
  validate({ params: idParamsSchema }),
  asyncHandler(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.json({ data: await getOrder(request.validated.params.id) });
  }),
);

adminRouter.post(
  "/orders/:id/payment-quote",
  validate({ params: idParamsSchema, body: paymentQuoteSchema }),
  asyncHandler(async (request, response) => {
    const result = await setPaymentQuote(
      request.validated.params.id,
      request.validated.body,
      request.user,
    );
    if (result.quoteChanged) await sendPaymentQuoteReadyEmail(result.order);
    response.setHeader("Cache-Control", "no-store");
    response.json({ data: { order: result.order }, meta: { quoteChanged: result.quoteChanged } });
  }),
);

adminRouter.post(
  "/orders/:id/refunds",
  adminRefundLimiter,
  validate({ params: idParamsSchema, body: razorpayRefundSchema }),
  asyncHandler(async (request, response) => {
    const result = await createAdminRefund(
      request.validated.params.id,
      request.validated.body,
      request.user,
      refundIdempotencyKey(request),
    );
    if (result.refundCreated || result.refundBecameProcessed) {
      await sendRefundUpdateEmail(result.order, result.refund);
    }
    response.setHeader("Cache-Control", "no-store");
    response.status(result.refundCreated ? 201 : 200).json({
      data: { order: result.order, payment: result.payment, refund: result.refund },
      meta: {
        refundCreated: result.refundCreated,
        refundBecameProcessed: result.refundBecameProcessed,
      },
    });
  }),
);

adminRouter.patch(
  "/orders/:id/status",
  validate({ params: idParamsSchema, body: orderStatusSchema }),
  asyncHandler(async (request, response) => {
    const { record: order, changed } = await updateOrderStatus(
      request.validated.params.id,
      request.validated.body,
      { withMeta: true },
    );
    if (changed) await sendOrderStatusEmail(order);
    response.json({
      data: order,
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
    const { record: inquiry, changed } = await updateCustomInquiry(
      request.validated.params.id,
      request.validated.body,
      { withMeta: true },
    );
    if (changed && request.validated.body.adminNote) {
      await sendInquiryReplyEmail(inquiry);
    }
    response.json({
      data: inquiry,
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
    const { record: message, changed } = await updateContact(
      request.validated.params.id,
      request.validated.body,
      { withMeta: true },
    );
    if (changed && request.validated.body.adminNote) {
      await sendContactReplyEmail(message);
    }
    response.json({ data: message });
  }),
);
