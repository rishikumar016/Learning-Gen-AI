import { ZodError } from "zod";
import { AppError } from "./error.js";

/**
 * Express middleware factory for Zod schema validation.
 *
 * @param {{ body?: ZodSchema, params?: ZodSchema, query?: ZodSchema }} schemas
 * @returns {import('express').RequestHandler}
 */
export function validate(schemas) {
  return (req, _res, next) => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      if (schemas.params) {
        // Express 5 makes req.params read-only; validate without reassigning
        schemas.params.parse(req.params);
      }
      if (schemas.query) {
        // Express 5 makes req.query a getter; store parsed result on req.validatedQuery
        req.validatedQuery = schemas.query.parse(req.query);
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const message = error.errors
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join(", ");
        return next(new AppError(message, 400));
      }
      return next(error);
    }
  };
}
