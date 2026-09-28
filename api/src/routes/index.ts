import { Router } from "express";
import { z } from "zod";

import { asyncHandler } from "../middleware/asyncHandler.js";
import { validate } from "../middleware/validate.js";
import { parseAddress, type VestflowService } from "../services/index.js";

const addressQuery = z.object({ address: z.string().min(1) });
const tokenQuery = z.object({ token: z.string().min(1) });

/**
 * Contract-level metadata. Cheap, cacheable reads that describe the deployed
 * contract rather than any one account.
 */
export function contractRouter(vestflow: VestflowService): Router {
  const router = Router();

  router.get(
    "/",
    asyncHandler(async (_req, res) => {
      const [version, cycleSecs, scheduleCount, ledger] = await Promise.all([
        vestflow.version(),
        vestflow.cycleSecs(),
        vestflow.scheduleCount(),
        vestflow.latestLedger(),
      ]);
      res.json({ data: { id: vestflow.contractId, version, cycleSecs, scheduleCount, ledger } });
    }),
  );

  router.get(
    "/balance/:token",
    validate({ params: z.object({ token: z.string().min(1) }) }),
    asyncHandler(async (req, res) => {
      const token = parseAddress(req.params.token, "token");
      const total = await vestflow.totalBalance(token);
      res.json({ data: { token: token.toString(), total } });
    }),
  );

  return router;
}

/**
 * Per-account read model: what an account can collect, how it is split, and how
 * it is streaming.
 */
export function accountRouter(vestflow: VestflowService): Router {
  const router = Router();

  router.get(
    "/:address/collectable",
    validate({ params: addressQuery, query: tokenQuery }),
    asyncHandler(async (req, res) => {
      const account = parseAddress(req.params.address, "address");
      const token = parseAddress(req.query.token as string, "token");
      const collectable = await vestflow.collectableAmount(account, token);
      res.json({ data: { account: account.toString(), token: token.toString(), collectable } });
    }),
  );

  router.get(
    "/:address/splits",
    validate({ params: addressQuery }),
    asyncHandler(async (req, res) => {
      const account = parseAddress(req.params.address, "address");
      const receivers = await vestflow.splits(account);
      res.json({ data: { account: account.toString(), receivers } });
    }),
  );

  router.get(
    "/:address/streams",
    validate({ params: addressQuery, query: tokenQuery }),
    asyncHandler(async (req, res) => {
      const funder = parseAddress(req.params.address, "address");
      const token = parseAddress(req.query.token as string, "token");
      const streams = await vestflow.streams(funder, token);
      res.json({
        data: { funder: funder.toString(), token: token.toString(), streams },
      });
    }),
  );

  router.get(
    "/:address/balance-at",
    validate({
      params: addressQuery,
      query: tokenQuery.extend({ at: z.coerce.number().int().min(0) }),
    }),
    asyncHandler(async (req, res) => {
      const account = parseAddress(req.params.address, "address");
      const token = parseAddress(req.query.token as string, "token");
      const result = await vestflow.balanceAt(account, token, req.query.at as number);
      res.json({ data: { account: account.toString(), token: token.toString(), ...result } });
    }),
  );

  return router;
}

/** Claimable-on-a-schedule reads, addressed by schedule id. */
export function scheduleRouter(vestflow: VestflowService): Router {
  const router = Router();

  const scheduleParams = z.object({ id: z.coerce.number().int().min(0) });

  router.get(
    "/:id/claimable",
    validate({
      params: scheduleParams,
      query: z.object({ at: z.coerce.number().int().min(0).optional() }),
    }),
    asyncHandler(async (req, res) => {
      const id = req.params.id as unknown as number;
      const at = req.query.at as number | undefined;
      const claimable = await vestflow.claimableAt(id, at);
      res.json({ data: { scheduleId: id, at: at ?? null, claimable } });
    }),
  );

  return router;
}
