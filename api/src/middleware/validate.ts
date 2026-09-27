import type { NextFunction, Request, RequestHandler, Response } from "express";
import { z, type ZodTypeAny } from "zod";

import { ApiError } from "../types/errors.js";

interface Schemas {
  params?: ZodTypeAny;
  query?: ZodTypeAny;
}

/**
 * Validate `req.params` / `req.query` against `schemas` and replace them with
 * the parsed (coerced, stripped) values, so handlers only ever see trusted data.
 */
export function validate(schemas: Schemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.params) {
        req.params = schemas.params.parse(req.params) as typeof req.params;
      }
      if (schemas.query) {
        const parsed = schemas.query.parse(req.query) as Record<string, unknown>;
        // Express 5 exposes `req.query` via a getter, so assign field-by-field
        // through a cast rather than replacing the property.
        Object.assign(req.query as object, parsed);
      }
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        next(ApiError.badRequest("Invalid request parameters", error.flatten()));
        return;
      }
      next(error);
    }
  };
}
