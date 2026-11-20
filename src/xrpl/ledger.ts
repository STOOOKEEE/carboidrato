// Port `Ledger` : les lectures du ledger validé dont ont besoin les modules migrés (docs/ARCHITECTURE.md),
// et son adaptateur réel qui enveloppe un `Client` xrpl.js.

import type { AccountObjectType, Client, LedgerEntry, TxResponse } from "xrpl";
import {
  getCredential,
  getLoanBroker,
  getMptBalance,
  getMptIssuance,
  getVault,
  listAccountObjects,
} from "./ledgerEntries.js";
import { rippledErrorCode } from "./rippledError.js";

export type LedgerTransaction = TxResponse["result"];

export interface Ledger {
  /** NetworkID du nœud, undefined s'il ne l'annonce pas. */
  networkId(): number | undefined;
  credential(subject: string, issuer: string, typeHex: string): Promise<LedgerEntry.Credential | undefined>;
  mptIssuance(id: string): Promise<LedgerEntry.MPTokenIssuance | undefined>;
  /** Solde MPT d'un compte (0 s'il n'a pas d'objet MPToken). */
  mptBalance(id: string, holder: string): Promise<bigint>;
  /** Lève une erreur si le Vault n'existe pas. */
  vault(id: string): Promise<LedgerEntry.Vault>;
  /** Lève une erreur si le LoanBroker n'existe pas. */
  loanBroker(id: string): Promise<LedgerEntry.LoanBroker>;
  accountObjects(account: string, type: AccountObjectType): Promise<LedgerEntry.LedgerEntry[]>;
  /** Transaction par son hash, undefined si le nœud ne la connaît pas. */
  transaction(hash: string): Promise<LedgerTransaction | undefined>;
}

async function findTransaction(client: Client, hash: string): Promise<LedgerTransaction | undefined> {
  try {
    return (await client.request({ command: "tx", transaction: hash })).result;
  } catch (error) {
    if (rippledErrorCode(error) === "txnNotFound") return undefined;
    throw error;
  }
}

export function xrplLedger(client: Client): Ledger {
  return {
    networkId: () => client.networkID,
    credential: (subject, issuer, typeHex) => getCredential(client, subject, issuer, typeHex),
    mptIssuance: (id) => getMptIssuance(client, id),
    mptBalance: (id, holder) => getMptBalance(client, id, holder),
    vault: (id) => getVault(client, id),
    loanBroker: (id) => getLoanBroker(client, id),
    accountObjects: (account, type) => listAccountObjects(client, account, type),
    transaction: (hash) => findTransaction(client, hash),
  };
}
