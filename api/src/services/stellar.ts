import {
  Address,
  Contract,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

import type { Config } from "../config/env.js";
import { ApiError } from "../types/errors.js";

/** A decoded return value from a simulated contract invocation. */
export interface ContractViewResult<T> {
  value: T;
  ledger: number;
}

/**
 * Thin, read-only wrapper over a Soroban RPC endpoint.
 *
 * Every call goes through `simulateTransaction`; this service never builds,
 * signs, or submits a transaction, so it holds no keys and can only read.
 */
export class StellarService {
  private readonly server: rpc.Server;
  private readonly networkPassphrase: string;
  private readonly contractId: string;

  public constructor(config: Config) {
    this.server = new rpc.Server(config.env.STELLAR_RPC_URL);
    this.networkPassphrase = config.env.STELLAR_NETWORK_PASSPHRASE;
    this.contractId = config.env.VESTFLOW_CONTRACT_ID;
  }

  public getContractAddress(): string {
    return this.contractId;
  }

  /** Probe used by `/health` to report RPC reachability. */
  public async getLatestLedger(): Promise<number> {
    const response = await this.server.getLatestLedger();
    if (response.error !== undefined) {
      throw ApiError.upstream("Stellar RPC getLatestLedger failed", response.error);
    }
    return response.result.sequenceNumber;
  }

  /**
   * Simulate a read-only contract call and decode its return value.
   *
   * @param fn - contract function name, e.g. `collectable_amount`
   * @param args - positional arguments; `Address` and scalar values are
   *               XDR-encoded by the SDK's `Contract` helper.
   */
  public async callView<T>(fn: string, args: unknown[]): Promise<ContractViewResult<T>> {
    const contract = new Contract(this.contractId);
    const operation = contract.call(fn, ...(args as never[]));

    const source = new Address(this.contractId).toString();
    const transaction = new rpc.TransactionBuilder(new Address(source), {
      fee: "100",
      networkPassphrase: this.networkPassphrase,
    })
      .setTimeout(30)
      .addOperation(operation)
      .build();

    const response = await this.server.simulateTransaction(transaction);
    if (response.error !== undefined) {
      throw ApiError.upstream("Stellar RPC simulateTransaction failed", {
        fn,
        error: response.error,
      });
    }
    const transactionData = response.result.transactionData;
    if (transactionData === undefined) {
      throw ApiError.upstream("Simulation returned no transaction data", { fn });
    }

    const latest = await this.getLatestLedger();
    return { value: decodeSimulatedReturn<T>(transactionData, fn), ledger: latest };
  }
}

/**
 * Pull the contract's return value out of a simulated transaction.
 *
 * `simulateTransaction` returns the transaction XDR rather than submitting it;
 * its first read/write footprint entry is the contract-data entry the
 * invocation produced, and the invocation's return value lives there.
 */
function decodeSimulatedReturn<T>(transactionData: string, fn: string): T {
  const data = xdr.SorobanTransactionData.fromXDR(transactionData, "base64");
  const ops = data.resources.footprint.ops;

  const contractDataOp = ops.find(
    (op) => op.switch() === xdr.LedgerEntryType.contractData(),
  );
  if (contractDataOp === undefined) {
    throw ApiError.upstream("Simulation produced no contract-data entry", { fn });
  }

  const entry = xdr.LedgerEntry.contractData(contractDataOp.contractData());
  const native = scValToNative(xdr.SorobanVal.fromXDR(entry.val().val()));
  return native as T;
}
