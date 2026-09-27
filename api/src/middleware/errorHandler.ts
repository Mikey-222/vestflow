import type { ErrorRequestHandler, RequestHandler } from "express";
import type { Logger } from "../config/logger.js";
import { describeError } from "../types/errors.js";

/** Terminal 404 for any path no router claimed. */
export const notFound: RequestHandler = (req, res) => {
  res.status(404).json({
    error: {
      code: "route_not_found",
      message: `No route matches ${req.method} ${req.path}`,
    },
  });
};

/**
 * Single JSON error envelope for the whole API. Contract-upstream failures are
 * logged with their cause and reported as 502 so clients can tell "the chain
 * said no" apart from "we have a bug".
 */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error, _req, res, _next) => {
    const described = describeError(error);
    const logPayload = {
      status: described.status,
      code: described.code,
      err: error,
    };
    if (described.status >= 500) {
      logger.error(logPayload, described.message);
    } else {
      logger.warn(logPayload, described.message);
    }
    res.status(described.status).json({
      error: {
        code: described.code,
        message: described.message,
        ...(described.details === undefined ? {} : { details: described.details }),
      },
    });
  };
}
