// Heure du ledger (secondes depuis l'époque Ripple) : c'est elle qui fait foi pour les phases du Vault et les échéances.

import { setTimeout as sleep } from "node:timers/promises";
import type { Client } from "xrpl";
import { log } from "../lib/logger.js";

const POLL_INTERVAL_MS = 2_000;

/** Heure de clôture du dernier ledger validé. */
export async function ledgerTime(client: Client): Promise<number> {
  const response = await client.request({ command: "ledger", ledger_index: "validated" });
  return response.result.ledger.close_time;
}

/** Attend qu'un ledger validé soit clos strictement après `target`. */
export async function waitForLedgerTimeAfter(client: Client, target: number, reason: string): Promise<void> {
  const remaining = target - (await ledgerTime(client));
  if (remaining >= 0) {
    log.info(`attente ~${remaining + 1} s : ${reason}`);
  }
  while ((await ledgerTime(client)) <= target) {
    await sleep(POLL_INTERVAL_MS);
  }
}
