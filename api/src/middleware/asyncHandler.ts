import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Wrap an async handler so a rejected promise reaches Express' error pipeline
 * instead of becoming an unhandled rejection.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
