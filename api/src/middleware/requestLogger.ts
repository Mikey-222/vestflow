import { randomUUID } from "node:crypto";

import type { NextFunction, Request, Response } from "express";
import pinoHttp from "pino-http";

import type { Logger } from "../config/logger.js";

/** Attach a request id and one structured log line per completed request. */
export function requestLogger(logger: Logger) {
  return pinoHttp({
    logger,
    genReqId: (req) => {
      const incoming = req.headers["x-request-id"];
      const id = Array.isArray(incoming) ? incoming[0] : incoming;
      return id && id.length <= 128 ? id : randomUUID();
    },
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
    customSuccessMessage: (req, res) =>
      `${req.method} ${req.url} -> ${res.statusCode}`,
    serializers: {
      req: (req) => ({ method: req.method, url: req.url }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  });
}

/** Reject oversized request bodies before they reach a route handler. */
export function requestBodyLimit(limit: string = "64kb") {
  return (req: Request, res: Response, next: NextFunction): void => {
    const declared = Number(req.headers["content-length"] ?? "0");
    const max = Number.parseInt(limit, 10);
    if (Number.isFinite(declared) && declared > max) {
      res.status(413).json({
        error: { code: "payload_too_large", message: "Request body is too large" },
      });
      return;
    }
    next();
  };
}
