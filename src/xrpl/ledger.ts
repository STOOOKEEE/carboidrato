// Port `Ledger` : les lectures du ledger validé dont ont besoin les modules migrés (docs/ARCHITECTURE.md),
// et son adaptateur réel qui enveloppe un `Client` xrpl.js.

import type { AccountObjectType, Client, LedgerEntry, TxResponse } from "xrpl";
import {
  getCredential,
  getLoan,
  getLoanBroker,
  getMptBalance,
  getMptIssuance,
  getVault,
  listAccountObjects,
} from "./ledgerEntries.js";
import { ledgerTime } from "./ledgerTime.js";
import { rippledErrorCode } from "./rippledError.js";
import { getStablecoinBalance, type Stablecoin } from "./stablecoin.js";

export type LedgerTransaction = TxResponse["result"];

export interface Ledger {
  /** NetworkID du nœud, undefined s'il ne l'annonce pas. */
  networkId(): number | undefined;
  credential(subject: string, issuer: string, typeHex: string): Promise<LedgerEntry.Credential | undefined>;
  mptIssuance(id: string): Promise<LedgerEntry.MPTokenIssuance | undefined>;
  /** Solde MPT d'un compte (0 s'il n'a pas d'objet MPToken). */
  mptBalance(id: string, holder: string): Promise<bigint>;
  /** Solde de l'actif du fonds (ligne de confiance vers son émetteur), en unités ; 0 sans ligne. */
  stablecoinBalance(asset: Stablecoin, holder: string): Promise<bigint>;
  /** Lève une erreur si le Vault n'existe pas. */
  vault(id: string): Promise<LedgerEntry.Vault>;
  /** Lève une erreur si le LoanBroker n'existe pas. */
  loanBroker(id: string): Promise<LedgerEntry.LoanBroker>;
  /** Lève une erreur si le Loan n'existe pas. */
  loan(id: string): Promise<LedgerEntry.Loan>;
  accountObjects(account: string, type: AccountObjectType): Promise<LedgerEntry.LedgerEntry[]>;
  /** Transaction par son hash, undefined si le nœud ne la connaît pas. */
  transaction(hash: string): Promise<LedgerTransaction | undefined>;
  /** Heure de clôture du dernier ledger validé (secondes depuis l'époque Ripple). */
  closeTime(): Promise<number>;
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
    stablecoinBalance: (asset, holder) => getStablecoinBalance(client, asset, holder),
    vault: (id) => getVault(client, id),
    loanBroker: (id) => getLoanBroker(client, id),
    loan: (id) => getLoan(client, id),
    accountObjects: (account, type) => listAccountObjects(client, account, type),
    transaction: (hash) => findTransaction(client, hash),
    closeTime: () => ledgerTime(client),
  };
}
