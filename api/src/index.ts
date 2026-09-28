import type { Server } from "node:http";

import { createApp } from "./app.js";
import { loadConfig } from "./config/env.js";
import { createLogger } from "./config/logger.js";

const SHUTDOWN_GRACE_MS = 10_000;

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const app = createApp({ config, logger });

  const server: Server = app.listen(config.env.PORT, config.env.HOST, () => {
    logger.info(
      { host: config.env.HOST, port: config.env.PORT, contractId: config.env.VESTFLOW_CONTRACT_ID },
      "vestflow-api listening",
    );
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "draining connections");
    const timer = setTimeout(() => {
      logger.error("graceful shutdown timed out; forcing exit");
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    timer.unref();
    server.close((error) => {
      if (error) {
        logger.error({ err: error }, "error while closing server");
        process.exit(1);
      }
      process.exit(0);
    });
  };

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => shutdown(signal));
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Failed to start vestflow-api: ${
      error instanceof Error ? error.message : String(error)
    }\n`,
  );
  process.exit(1);
});
