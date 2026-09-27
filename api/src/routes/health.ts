import { Router } from "express";

import { asyncHandler } from "../middleware/asyncHandler.js";
import type { VestflowService } from "../services/index.js";

/**
 * Liveness and readiness probes.
 *
 * `/health` is a pure liveness check and never touches the network, so an RPC
 * outage cannot cause an orchestrator to kill a healthy process.
 * `/ready` additionally verifies the Soroban RPC is reachable.
 */
export function healthRouter(vestflow: VestflowService): Router {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.json({ status: "ok", uptimeSeconds: Math.round(process.uptime()) });
  });

  router.get(
    "/ready",
    asyncHandler(async (_req, res) => {
      const ledger = await vestflow.latestLedger();
      res.json({ status: "ready", contractId: vestflow.contractId, ledger });
    }),
  );

  return router;
}
