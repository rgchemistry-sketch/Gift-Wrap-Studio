import { AppError } from "../lib/errors.js";

const formatIssues = (issues) =>
  issues.map((issue) => ({
    field: issue.path.join("."),
    message: issue.message,
  }));

export const validate = (schemas) => (request, _response, next) => {
  const validated = {};

  for (const [location, schema] of Object.entries(schemas)) {
    const result = schema.safeParse(request[location]);
    if (!result.success) {
      return next(
        new AppError(
          422,
          "VALIDATION_ERROR",
          "Please check the submitted information",
          formatIssues(result.error.issues),
        ),
      );
    }
    validated[location] = result.data;
  }

  request.validated = { ...(request.validated || {}), ...validated };
  return next();
};
