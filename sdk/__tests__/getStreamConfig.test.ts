// Unit tests for VestflowClient.getStreamConfig (#948)
//
// Covers: an active stream reporting the right rate and balance, a missing
// stream resolving to null, invalid-address rejection before any request, and
// indexer failures surfacing as a clear Error.
//
// No live network: `fetch` is stubbed globally and every test asserts the
// client issued exactly the request it intended (or none at all).

import { describe, it, expect, vi, afterEach } from "vitest";
import { VestflowClient } from "../src/client";
import type { StreamConfig } from "../src/types";

const SENDER = "GDZ2GDLBPUCEXA3I5U7WN5E3CNQ3JBP5FK464EMLTHPCX6KVB5N4A4YT";
const RECEIVER = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
const TOKEN = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

/** The indexer speaks snake_case; keep the fixture in its real wire shape. */
function makeIndexerBody(overrides: Record<string, unknown> = {}) {
  return {
    sender: SENDER,
    receiver: RECEIVER,
    token: TOKEN,
    rate: "1000000",
    start_time: 1_700_000_000,
    balance: "5000000000",
    max_end_time: 1_700_086_400,
    ...overrides,
  };
}

function stubFetch(response: unknown, init: { ok?: boolean; status?: number } = {}) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: "OK",
    json: async () => response,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("getStreamConfig (#948)", () => {
  it("returns the rate and balance of an active stream", async () => {
    stubFetch(makeIndexerBody());

    const client = new VestflowClient({ network: "testnet" });
    const config = await client.getStreamConfig(SENDER, RECEIVER, TOKEN);

    expect(config).not.toBeNull();
    const cfg = config as StreamConfig;
    // The two numbers the caller actually needs: how fast it flows, and how
    // much runway is left to fund it.
    expect(cfg.ratePerSec).toBe(1_000_000n);
    expect(cfg.balance).toBe(5_000_000_000n);
    expect(cfg.sender).toBe(SENDER);
    expect(cfg.receiver).toBe(RECEIVER);
    expect(cfg.token).toBe(TOKEN);
    expect(cfg.startTime).toBe(1_700_000_000);
    expect(cfg.maxEndTime).toBe(1_700_086_400);
  });

  it("requests the sender/receiver/token endpoint for the client's network", async () => {
    const fetchMock = stubFetch(makeIndexerBody());

    const client = new VestflowClient({ network: "testnet" });
    await client.getStreamConfig(SENDER, RECEIVER, TOKEN);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain(`/streams/${SENDER}/${RECEIVER}/${TOKEN}`);
    expect(url).toContain("network=testnet");
  });

  it("returns null when no stream exists", async () => {
    stubFetch({ error: "Stream not found" }, { ok: false, status: 404 });

    const client = new VestflowClient({ network: "testnet" });

    // Absent stream is an ordinary answer, not an exception.
    await expect(
      client.getStreamConfig(SENDER, RECEIVER, TOKEN)
    ).resolves.toBeNull();
  });

  it("preserves a null maxEndTime for an open-ended stream", async () => {
    stubFetch(makeIndexerBody({ max_end_time: null }));

    const client = new VestflowClient({ network: "testnet" });
    const config = await client.getStreamConfig(SENDER, RECEIVER, TOKEN);

    expect(config?.maxEndTime).toBeNull();
    expect(config?.ratePerSec).toBe(1_000_000n);
  });

  it("rejects an invalid sender address before making a request", async () => {
    const fetchMock = stubFetch(makeIndexerBody());

    const client = new VestflowClient({ network: "testnet" });

    await expect(
      client.getStreamConfig("not-a-stellar-address", RECEIVER, TOKEN)
    ).rejects.toThrow(TypeError);
    await expect(
      client.getStreamConfig("not-a-stellar-address", RECEIVER, TOKEN)
    ).rejects.toThrow(/sender/);
    // Nothing was sent: a typo is the caller's bug, not a round trip.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid receiver address before making a request", async () => {
    const fetchMock = stubFetch(makeIndexerBody());

    const client = new VestflowClient({ network: "testnet" });

    await expect(
      client.getStreamConfig(SENDER, "GTOOSHORT", TOKEN)
    ).rejects.toThrow(/receiver/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("wraps a non-404 indexer error status", async () => {
    stubFetch({ error: "boom" }, { ok: false, status: 500 });

    const client = new VestflowClient({ network: "testnet" });

    await expect(client.getStreamConfig(SENDER, RECEIVER, TOKEN)).rejects.toThrow(
      /Indexer request failed: 500/
    );
  });

  it("surfaces a transport failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("ECONNREFUSED"))
    );

    const client = new VestflowClient({ network: "testnet" });

    await expect(client.getStreamConfig(SENDER, RECEIVER, TOKEN)).rejects.toThrow(
      /ECONNREFUSED/
    );
  });
});
