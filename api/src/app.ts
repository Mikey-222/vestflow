import compression from "compression";
import cors from "cors";
import express, { type Express } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";

import type { Config } from "./config/env.js";
import type { Logger } from "./config/logger.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { requestBodyLimit, requestLogger } from "./middleware/requestLogger.js";
import { accountRouter, contractRouter, healthRouter, scheduleRouter } from "./routes/index.js";
import { StellarService, VestflowService } from "./services/index.js";

/** Dependencies wired into the app, so tests can inject doubles. */
export interface AppDependencies {
  config: Config;
  logger: Logger;
  vestflow?: VestflowService;
}

function resolveCorsOrigin(config: Config): cors.CorsOptions["origin"] {
  if (config.corsOrigins === "*") return true;
  const allowed = new Set(config.corsOrigins);
  return (origin, callback) => {
    if (origin === undefined || allowed.has(origin)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  };
}

/** Build the Express application. Does not listen — see `index.ts`. */
export function createApp({ config, logger, vestflow }: AppDependencies): Express {
  const app = express();
  const vestflowService = vestflow ?? new VestflowService(new StellarService(config));

  // Trust X-Forwarded-* only when explicitly enabled, so a direct-to-internet
  // deployment cannot be used to spoof its IP past the rate limiter.
  app.set("trust proxy", config.env.TRUST_PROXY ? 1 : false);
  app.disable("x-powered-by");

  app.use(helmet());
  app.use(cors({ origin: resolveCorsOrigin(config) }));
  app.use(compression());
  app.use(express.json({ limit: "64kb" }));
  app.use(requestBodyLimit("65536"));
  app.use(requestLogger(logger));

  app.use(
    rateLimit({
      windowMs: config.env.RATE_LIMIT_WINDOW_MS,
      limit: config.env.RATE_LIMIT_MAX,
      standardHeaders: "draft-7",
      legacyHeaders: false,
    }),
  );

  app.use("/", healthRouter(vestflowService));
  app.use("/v1/contract", contractRouter(vestflowService));
  app.use("/v1/accounts", accountRouter(vestflowService));
  app.use("/v1/schedules", scheduleRouter(vestflowService));

  app.use(notFound);
  app.use(errorHandler(logger));

  return app;
}
