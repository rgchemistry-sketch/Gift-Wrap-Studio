import { randomUUID } from "node:crypto";
import { AppError } from "../lib/errors.js";
import { env } from "../config/env.js";

export const requestId = (request, response, next) => {
  const supplied = request.get("x-request-id");
  request.id = supplied && /^[A-Za-z0-9._-]{8,100}$/.test(supplied) ? supplied : randomUUID();
  response.setHeader("x-request-id", request.id);
  next();
};

export const notFoundHandler = (request, _response, next) => {
  next(new AppError(404, "ROUTE_NOT_FOUND", `No API route matches ${request.method} ${request.path}`));
};

const normalizeError = (error) => {
  if (error instanceof AppError) return error;
  if (error?.type === "entity.parse.failed") {
    return new AppError(400, "INVALID_JSON", "The request body is not valid JSON");
  }
  if (error?.type === "entity.too.large") {
    return new AppError(413, "PAYLOAD_TOO_LARGE", "The request body is too large");
  }
  if (error?.code === 11_000 || error?.code === 11000) {
    const fields = Object.keys(error.keyPattern || error.keyValue || {});
    return new AppError(
      409,
      "DUPLICATE_VALUE",
      "That value is already in use",
      fields.map((field) => ({ field, message: "That value is already in use" })),
    );
  }
  if (error?.name === "ValidationError") {
    return new AppError(
      422,
      "VALIDATION_ERROR",
      "Please check the submitted information",
      Object.entries(error.errors || {}).map(([field, issue]) => ({ field, message: issue.message })),
    );
  }
  if (error?.name === "CastError") return new AppError(404, "NOT_FOUND", "Resource not found");
  return new AppError(500, "INTERNAL_ERROR", "Something went wrong on our side");
};

export const errorHandler = (error, request, response, _next) => {
  const normalized = normalizeError(error);
  if (normalized.status >= 500 && !(error instanceof AppError && error.isOperational)) {
    console.error(`[${request.id}]`, error);
  }

  const body = {
    error: {
      code: normalized.code,
      message: normalized.message,
      requestId: request.id,
      ...(normalized.details !== undefined ? { details: normalized.details } : {}),
      ...(!env.isProduction && normalized.status === 500 && error?.stack
        ? { debug: error.stack.split("\n").slice(0, 4) }
        : {}),
    },
  };
  response.status(normalized.status).json(body);
};
