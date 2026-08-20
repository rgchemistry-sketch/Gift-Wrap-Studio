export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.isOperational = true;
  }
}

export const badRequest = (message, details) =>
  new AppError(400, "BAD_REQUEST", message, details);

export const unauthorized = (message = "Authentication required") =>
  new AppError(401, "UNAUTHORIZED", message);

export const forbidden = (message = "You do not have permission to perform this action") =>
  new AppError(403, "FORBIDDEN", message);

export const sessionIdentityChanged = () =>
  new AppError(
    409,
    "SESSION_IDENTITY_CHANGED",
    "Your signed-in account changed. Please review this request before sending it again",
  );

export const notFound = (resource = "Resource", details) =>
  new AppError(404, "NOT_FOUND", `${resource} not found`, details);

export const conflict = (message, details) =>
  new AppError(409, "CONFLICT", message, details);

export const idempotencyKeyReused = () =>
  new AppError(
    409,
    "IDEMPOTENCY_KEY_REUSED",
    "This Idempotency-Key was already used for a different order",
  );

export const welcomeOfferInvalid = () =>
  new AppError(400, "WELCOME_OFFER_INVALID", "This coupon code is not valid");

export const welcomeOfferExcluded = (bulkThreshold) =>
  new AppError(
    400,
    "WELCOME_OFFER_EXCLUDED",
    `The welcome offer is not available for corporate gifts or quantities of ${bulkThreshold} or more`,
  );

export const welcomeOfferIneligible = () =>
  new AppError(
    409,
    "WELCOME_OFFER_INELIGIBLE",
    "The welcome offer is available on your first order only",
  );

export const accountLinkRequired = (message = "Verify your email to connect this sign-in method") =>
  new AppError(409, "ACCOUNT_LINK_REQUIRED", message);

export const configurationError = (missing) =>
  new AppError(
    503,
    "SERVICE_NOT_CONFIGURED",
    "This service is not configured yet",
    { missing },
  );

export const databaseUnavailable = () =>
  new AppError(
    503,
    "DATABASE_UNAVAILABLE",
    "The studio database is temporarily unavailable. Please try again shortly",
  );

export const rateLimited = (
  message = "Too many requests. Please try again later",
  details,
) => new AppError(429, "RATE_LIMITED", message, details);
