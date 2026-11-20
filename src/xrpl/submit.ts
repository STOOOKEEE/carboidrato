// Soumission séquentielle d'une transaction et attente de sa validation, avec affichage hash + résultat.

import { setTimeout as sleep } from "node:timers/promises";
import {
  decode,
  type Client,
  type SubmittableTransaction,
  type TransactionMetadata,
  type Wallet,
} from "xrpl";
import { log } from "../lib/logger.js";
import { rippledErrorCode } from "./rippledError.js";

const POLL_INTERVAL_MS = 1_000;
const SUCCESS = "tesSUCCESS";
/** Préfixes de codes qui garantissent que la transaction n'entrera jamais dans un ledger. */
const NEVER_APPLIED_PREFIXES = ["tem", "tef", "tel"];

export interface TxOutcome {
  hash: string;
  result: string;
  meta: TransactionMetadata;
}

export class UnexpectedTxResult extends Error {
  constructor(
    readonly label: string,
    readonly result: string,
    readonly hash: string,
  ) {
    super(`${label} : résultat inattendu ${result} (hash ${hash})`);
  }
}

function readLastLedgerSequence(txBlob: string): number {
  const value = decode(txBlob).LastLedgerSequence;
  if (typeof value !== "number") {
    throw new Error("Transaction signée sans LastLedgerSequence");
  }
  return value;
}

async function waitForValidation(client: Client, hash: string, lastLedger: number): Promise<TxOutcome> {
  for (;;) {
    await sleep(POLL_INTERVAL_MS);
    const response = await client
      .request({ command: "tx", transaction: hash })
      .catch((error: unknown) => {
        // txnNotFound est normal tant que la transaction n'est pas dans un ledger.
        if (rippledErrorCode(error) === "txnNotFound") return undefined;
        throw error;
      });
    if (response?.result.validated) {
      const meta = response.result.meta;
      if (meta === undefined || typeof meta === "string") {
        throw new Error(`Métadonnées absentes pour ${hash}`);
      }
      return { hash, result: meta.TransactionResult, meta };
    }
    if ((await client.getLedgerIndex()) > lastLedger) {
      throw new Error(`Transaction ${hash} expirée (LastLedgerSequence ${lastLedger} dépassé)`);
    }
  }
}

/** Soumet un blob déjà signé et attend sa validation. Lève une erreur si le résultat n'est pas attendu. */
export async function submitSignedBlob(
  client: Client,
  txBlob: string,
  hash: string,
  label: string,
  expected: readonly string[] = [SUCCESS],
): Promise<TxOutcome> {
  const submitted = await client.request({ command: "submit", tx_blob: txBlob });
  const preliminary = submitted.result.engine_result;
  if (NEVER_APPLIED_PREFIXES.some((prefix) => preliminary.startsWith(prefix))) {
    log.tx(label, hash, preliminary);
    throw new UnexpectedTxResult(label, `${preliminary} (${submitted.result.engine_result_message})`, hash);
  }
  const outcome = await waitForValidation(client, hash, readLastLedgerSequence(txBlob));
  log.tx(label, outcome.hash, outcome.result);
  if (!expected.includes(outcome.result)) {
    throw new UnexpectedTxResult(label, outcome.result, outcome.hash);
  }
  return outcome;
}

/** Complète (autofill), signe avec `wallet` puis soumet la transaction. */
export async function submitTx(
  client: Client,
  tx: SubmittableTransaction,
  wallet: Wallet,
  label: string,
  expected: readonly string[] = [SUCCESS],
): Promise<TxOutcome> {
  const prepared = await client.autofill(tx);
  const { tx_blob, hash } = wallet.sign(prepared);
  return submitSignedBlob(client, tx_blob, hash, label, expected);
}
