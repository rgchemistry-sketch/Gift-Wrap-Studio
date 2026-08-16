import { Router } from "express";
import { asyncHandler } from "../lib/async-handler.js";
import { validate } from "../middleware/validate.js";
import { getProductBySlug, listProductCategories, listProducts } from "../services/store.js";
import { productQuerySchema, slugParamsSchema } from "../validation/schemas.js";

export const productsRouter = Router();

productsRouter.get(
  "/",
  validate({ query: productQuerySchema }),
  asyncHandler(async (request, response) => {
    const result = await listProducts(request.validated.query);
    response.setHeader("Cache-Control", "no-store");
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

productsRouter.get(
  "/categories",
  asyncHandler(async (_request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.json({ data: await listProductCategories() });
  }),
);

productsRouter.get(
  "/:slug",
  validate({ params: slugParamsSchema }),
  asyncHandler(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.json({ data: await getProductBySlug(request.validated.params.slug) });
  }),
);
