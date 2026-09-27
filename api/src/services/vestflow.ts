import { Address } from "@stellar/stellar-sdk";

import { ApiError } from "../types/errors.js";
import type { StellarService } from "./stellar.js";

/** One entry of a `SplitReceiver` union as returned by `splits`. */
export type SplitReceiver =
  | { address: string; weight: number }
  | { nftContract: string; tokenId: number; weight: number };

/** Stream configuration as returned by `get_account_token_streams`. */
export interface AccountTokenStreams {
  funder: string;
  token: string;
  receivers: { receiver: string; amtPerSec: number }[];
  balance: number;
  startTime: number;
  lastUpdate: number;
}

/**
 * VestFlow-specific read model.
 *
 * Each method maps to one contract view so route handlers stay free of XDR and
 * contract-call plumbing. `ContractError` codes come from the table in
 * `docs/contract-errors.md`.
 */
export class VestflowService {
  public constructor(private readonly stellar: StellarService) {}

  public get contractId(): string {
    return this.stellar.getContractAddress();
  }

  public async version(): Promise<string> {
    return (await this.stellar.callView<string>("version", [])).value;
  }

  public async cycleSecs(): Promise<number> {
    return (await this.stellar.callView<number>("cycle_secs", [])).value;
  }

  public async scheduleCount(): Promise<number> {
    return (await this.stellar.callView<number>("schedule_count", [])).value;
  }

  /** Total `token` held by the contract. */
  public async totalBalance(token: Address): Promise<number> {
    return (
      await this.stellar.callView<number>("total_balance", [token.toString()])
    ).value;
  }

  /** `token` `account` can collect from its streams right now. */
  public async collectableAmount(
    account: Address,
    token: Address,
  ): Promise<number> {
    return (
      await this.stellar.callView<number>("collectable_amount", [
        account.toString(),
        token.toString(),
      ])
    ).value;
  }

  /** Claimable on `scheduleId` as of `at` (defaults to the ledger timestamp). */
  public async claimableAt(scheduleId: number, at?: number): Promise<number> {
    const args: unknown[] = [scheduleId];
    if (at !== undefined) args.push(at);
    return (await this.stellar.callView<number>("claimable_at_timestamp", args))
      .value;
  }

  public async splits(account: Address): Promise<SplitReceiver[]> {
    const raw = (
      await this.stellar.callView<unknown[]>("splits", [account.toString()])
    ).value;
    return raw.map((entry) => normaliseSplitReceiver(entry, account));
  }

  public async streams(
    funder: Address,
    token: Address,
  ): Promise<AccountTokenStreams | null> {
    const raw = (
      await this.stellar.callView<Record<string, unknown> | null>(
        "get_account_token_streams",
        [funder.toString(), token.toString()],
      )
    ).value;
    if (raw === null) return null;
    return {
      funder: readString(raw, "funder"),
      token: readString(raw, "token"),
      receivers: readList(raw, "receivers").map((entry) => ({
        receiver: readString(entry, "receiver"),
        amtPerSec: readNumber(entry, "amt_per_sec"),
      })),
      balance: readNumber(raw, "balance"),
      startTime: readNumber(raw, "start_time"),
      lastUpdate: readNumber(raw, "last_update"),
    };
  }

  /**
   * Streaming balance of `account` for `token` as of `at` (#598).
   *
   * Passing no `receivers`/`history` lets the contract fall back to its stored
   * stream configuration, which is the common read-only case.
   */
  public async balanceAt(
    account: Address,
    token: Address,
    at: number,
  ): Promise<{ balance: number; ledger: number }> {
    const result = await this.stellar.callView<number>("balance_at", [
      account.toString(),
      token.toString(),
      at,
      [],
      [],
    ]);
    return { balance: result.value, ledger: result.ledger };
  }

  public async latestLedger(): Promise<number> {
    return this.stellar.getLatestLedger();
  }
}

/** Parse a Stellar contract id / account address, rejecting malformed input. */
export function parseAddress(value: string, field: string): Address {
  try {
    return new Address(value);
  } catch {
    throw ApiError.badRequest(`\`${field}\` is not a valid Stellar address`, {
      field,
      value,
    });
  }
}

function normaliseSplitReceiver(
  entry: unknown,
  account: Address,
): SplitReceiver {
  const raw = asRecord(entry, account.toString());
  if ("address" in raw && typeof raw.address === "string") {
    return {
      address: raw.address,
      weight: readNumber(raw, "weight"),
    };
  }
  if ("nft_contract" in raw) {
    return {
      nftContract: readString(raw, "nft_contract"),
      tokenId: readNumber(raw, "token_id"),
      weight: readNumber(raw, "weight"),
    };
  }
  throw ApiError.upstream("Unrecognised split receiver shape", { entry });
}

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw ApiError.upstream("Expected an object from the contract", { context, value });
  }
  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw ApiError.upstream(`Expected string field \`${key}\``, { key, value });
  }
  return value;
}

function readNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (typeof value === "bigint") return Number(value);
  throw ApiError.upstream(`Expected numeric field \`${key}\``, { key, value });
}

function readList(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw ApiError.upstream(`Expected array field \`${key}\``, { key, value });
  }
  return value;
}
