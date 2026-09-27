import pino, { type Logger } from "pino";

import type { Config } from "../config/env.js";

/** Build the process-wide structured logger. */
export function createLogger(config: Config): Logger {
  return pino({
    level: config.env.LOG_LEVEL,
    base: { service: "vestflow-api" },
    redact: {
      paths: ["req.headers.authorization", "req.headers.cookie"],
      remove: true,
    },
    transport: config.isProduction
      ? undefined
      : {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:HH:MM:ss" },
        },
  });
}

export type { Logger };
