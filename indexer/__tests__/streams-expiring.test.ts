/**
 * Issue #947 — integration tests for `GET /streams/expiring`.
 *
 * These run against a real seeded in-memory SQLite database created from the
 * production `schema.sql`, and drive the real HTTP server over a real socket.
 * The DB layer is not mocked: rows are inserted directly and the endpoint's own
 * SQL is exercised, so a query that disagrees with the shipped schema fails
 * here rather than in production.
 *
 * `_setTestDb` only points the indexer's connection map at the test database —
 * the schema, indexes and queries are all the real ones.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import http from "http";
import { _clearTestDb, _setTestDb } from "../src/db";
import { createServer } from "../src/server";
import { createTestDb, type TestDb } from "./helpers/createTestDb";

const ACCOUNT = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN2";
const OTHER_ACCOUNT = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBYM2";
const RECEIVER = "GBSOV3F63VBMLDKD3JV5HQC5KPVXJQEQHP5TPUMZWNMCZZQ6SKF2OL3A";
const RECEIVER_2 = "GDYIE2JH5OZ7HSHENWVPB5WY4VH2AZOKUJLR5C2UKNOWQ6BMQEXQPQMPB";
const TOKEN = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const DAY = 86_400;

describe("GET /streams/expiring", () => {
  let helpers: TestDb;
  let server: http.Server;
  let baseUrl: string;

  const now = () => Math.floor(Date.now() / 1000);

  /**
   * Insert a stream row. `endsInDays` is relative to now so the assertions do
   * not rot as wall-clock time passes; pass `null` for an open-ended stream.
   */
  function seedStream(options: {
    id: string;
    account?: string;
    receiver?: string;
    token?: string;
    endsInDays: number | null;
    endedAt?: number | null;
  }): void {
    helpers.db
      .prepare(
        `INSERT INTO drips_streams
           (id, account, receiver, token, rate_per_second, estimated_end_time, ended_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        options.id,
        options.account ?? ACCOUNT,
        options.receiver ?? RECEIVER,
        options.token ?? TOKEN,
        "1000",
        options.endsInDays === null ? null : now() + options.endsInDays * DAY,
        options.endedAt ?? null,
        now() - 10 * DAY,
      );
  }

  async function get(query: string): Promise<{ status: number; body: any }> {
    const res = await fetch(`${baseUrl}/streams/expiring?network=testnet&${query}`);
    return { status: res.status, body: await res.json() };
  }

  beforeEach(async () => {
    helpers = createTestDb();
    _setTestDb("testnet", helpers.db);

    server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = address && typeof address !== "string" ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    _clearTestDb("testnet");
    helpers.close();
  });

  it("includes a stream expiring in 3 days", async () => {
    seedStream({ id: "s-soon", endsInDays: 3 });

    const { status, body } = await get(`account=${ACCOUNT}`);

    expect(status).toBe(200);
    expect(body.streams).toHaveLength(1);
    expect(body.streams[0].receiver).toBe(RECEIVER);
    expect(body.streams[0].token).toBe(TOKEN);
    expect(body.window_days).toBe(7);
  });

  it("excludes a stream expiring in 10 days under the default 7-day window", async () => {
    seedStream({ id: "s-soon", receiver: RECEIVER, endsInDays: 3 });
    seedStream({ id: "s-later", receiver: RECEIVER_2, endsInDays: 10 });

    const { body } = await get(`account=${ACCOUNT}`);

    // Distinct receivers so the assertion identifies *which* stream survived
    // rather than just how many did.
    expect(body.streams).toHaveLength(1);
    expect(body.streams[0].receiver).toBe(RECEIVER);
    expect(body.streams.map((s: { receiver: string }) => s.receiver)).not.toContain(
      RECEIVER_2,
    );
    expect(body.streams[0].estimated_end_time).toBeGreaterThan(now());
    expect(body.streams[0].estimated_end_time).toBeLessThanOrEqual(now() + 7 * DAY);
  });

  it("returns an empty array when the account has no streams", async () => {
    const { status, body } = await get(`account=${ACCOUNT}`);

    expect(status).toBe(200);
    expect(body.streams).toEqual([]);
  });

  it("returns 400 for an invalid address", async () => {
    const { status, body } = await get(`account=not-a-stellar-address`);

    expect(status).toBe(400);
    expect(body.error).toMatch(/valid Stellar address/i);
  });

  // ── Behaviour the four cases above imply but do not pin down ──────────

  it("honours an explicit windowDays", async () => {
    seedStream({ id: "s-later", endsInDays: 10 });

    const narrow = await get(`account=${ACCOUNT}`);
    expect(narrow.body.streams).toHaveLength(0);

    const wide = await get(`account=${ACCOUNT}&windowDays=30`);
    expect(wide.body.streams).toHaveLength(1);
    expect(wide.body.window_days).toBe(30);
  });

  it("orders streams soonest-ending first", async () => {
    seedStream({ id: "s-5", endsInDays: 5 });
    seedStream({ id: "s-1", endsInDays: 1 });
    seedStream({ id: "s-3", endsInDays: 3 });

    const { body } = await get(`account=${ACCOUNT}`);

    const ends = body.streams.map((s: { estimated_end_time: number }) => s.estimated_end_time);
    expect(ends).toEqual([...ends].sort((a, b) => a - b));
    expect(ends).toHaveLength(3);
  });

  it("excludes open-ended streams, already-ended streams and other accounts", async () => {
    seedStream({ id: "s-open-ended", endsInDays: null });
    // Projected to have ended a day ago but not yet reaped.
    seedStream({ id: "s-already-past", endsInDays: -1 });
    seedStream({ id: "s-closed", endsInDays: 2, endedAt: now() - DAY });
    seedStream({ id: "s-other-account", account: OTHER_ACCOUNT, endsInDays: 2 });
    seedStream({ id: "s-keep", endsInDays: 2 });

    const { body } = await get(`account=${ACCOUNT}`);

    expect(body.streams).toHaveLength(1);
    expect(body.streams[0].estimated_end_time).toBeGreaterThan(now());
  });

  it("returns 400 for a non-positive windowDays", async () => {
    const { status, body } = await get(`account=${ACCOUNT}&windowDays=0`);

    expect(status).toBe(400);
    expect(body.error).toMatch(/windowDays/);
  });
});
