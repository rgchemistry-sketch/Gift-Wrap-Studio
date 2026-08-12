import { Router } from "express";
import { asyncHandler } from "../lib/async-handler.js";
import { getStudioSettings } from "../services/store.js";

export const settingsRouter = Router();

settingsRouter.get(
  "/",
  asyncHandler(async (_request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.json({ data: await getStudioSettings() });
  }),
);
