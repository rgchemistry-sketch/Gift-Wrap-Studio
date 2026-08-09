import { AppError } from "../lib/errors.js";

export const rateLimitHandler = (message) => (_request, _response, next) => {
  next(new AppError(429, "RATE_LIMITED", message));
};
