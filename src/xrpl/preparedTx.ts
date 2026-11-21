// Transaction préparée par Bari et signée dans le wallet de l'utilisateur : lectures et soumission sur le nœud, contrôle
// que le blob signé est exactement celle-ci, et dernière transaction préparée de chaque utilisateur, en mémoire.

import { decode, encode, verifySignature, type Client, type SubmittableTransaction, type Transaction } from "xrpl";
import type { Ledger } from "./ledger.js";
import { submitSignedBlob, type TxOutcome } from "./submit.js";

/** ≈ 5 minutes de ledgers de 3 s : le temps de lire et signer dans la fenêtre d'Otsu. */
export const SIGNING_WINDOW_LEDGERS = 100;
/** Résultat préliminaire d'une transaction soumise après son LastLedgerSequence. */
export const EXPIRED_RESULT = "tefMAX_LEDGER";
const SUCCESS = "tesSUCCESS";

/** Préparation et soumission d'une transaction signée dans un wallet : le nœud en production, des faux dans les tests. */
export interface WalletTxPorts {
  /** Prochaine séquence du compte et dernier ledger validé. */
  accountState(account: string): Promise<{ sequence: number; ledgerIndex: number }>;
  /** Complète les frais (et le NetworkID) d'une transaction déjà séquencée ; `signersCount` : signatures de BatchSigners. */
  autofill<T extends SubmittableTransaction>(tx: T, signersCount?: number): Promise<T>;
  /** Soumet un blob signé et attend sa validation ; lève `UnexpectedTxResult` hors tesSUCCESS. */
  submitSigned(txBlob: string, hash: string, label: string): Promise<TxOutcome>;
}

export function clientWalletTxPorts(client: Client): WalletTxPorts {
  return {
    accountState: async (account) => {
      const [info, ledgerIndex] = await Promise.all([
        client.request({ command: "account_info", account, ledger_index: "current" }),
        client.getLedgerIndex(),
      ]);
      return { sequence: info.result.account_data.Sequence, ledgerIndex };
    },
    autofill: (tx, signersCount) => client.autofill(tx, signersCount),
    submitSigned: (txBlob, hash, label) => submitSignedBlob(client, txBlob, hash, label),
  };
}

/** Toutes les transactions internes d'un Batch validées et en tesSUCCESS (tfAllOrNothing : toutes ou aucune). */
export async function innerApplied(ledger: Pick<Ledger, "transaction">, innerHashes: readonly string[]): Promise<boolean> {
  const found = await Promise.all(innerHashes.map((hash) => ledger.transaction(hash)));
  return found.every((tx) => tx?.validated === true && typeof tx.meta === "object" && tx.meta.TransactionResult === SUCCESS);
}

/**
 * Vrai si `txBlob` est `prepared` signée telle quelle : signature valide, et octet pour octet identique une fois retirés
 * `TxnSignature`, `SigningPubKey` et `Signers` (les `BatchSigners` d'un Batch restent comparés).
 */
export function matchesPrepared(prepared: SubmittableTransaction, txBlob: string): boolean {
  try {
    if (!verifySignature(txBlob)) return false;
    const { TxnSignature: _signature, SigningPubKey: _key, Signers: _signers, ...unsigned } = decode(txBlob);
    return encode(unsigned as unknown as Transaction) === encode(prepared);
  } catch {
    return false;
  }
}

/** Dernière transaction préparée de chaque utilisateur : en préparer une autre remplace la précédente. */
export class PreparedStore<T> {
  private readonly byUser = new Map<string, T>();

  set(userId: string, prepared: T): void {
    this.byUser.set(userId, prepared);
  }

  get(userId: string): T | undefined {
    return this.byUser.get(userId);
  }

  delete(userId: string): void {
    this.byUser.delete(userId);
  }
}
