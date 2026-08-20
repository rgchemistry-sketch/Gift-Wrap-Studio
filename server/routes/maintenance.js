import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { env } from "../config/env.js";
import { asyncHandler } from "../lib/async-handler.js";
import { configurationError, unauthorized } from "../lib/errors.js";
import { runExpiredUploadGrantSweep } from "../services/upload-cleanup.js";

export const maintenanceRouter = Router();

const hasCronAuthorization = (request) => {
  const expected = `Bearer ${env.cronSecret}`;
  const supplied = request.get("authorization") || "";
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return (
    expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes)
  );
};

maintenanceRouter.get(
  "/uploads/cleanup",
  asyncHandler(async (request, response) => {
    if (!env.cronSecret) throw configurationError(["CRON_SECRET"]);
    if (!hasCronAuthorization(request)) throw unauthorized("Invalid maintenance credentials");
    const result = await runExpiredUploadGrantSweep({ limit: env.uploadCleanupBatchSize });
    response.setHeader("Cache-Control", "no-store");
    response.json({ data: result });
  }),
);
