// Transaction préparée par Bari et signée dans le wallet de l'utilisateur : contrôle que le blob signé est exactement
// celle-ci, et dernière transaction préparée de chaque utilisateur, en mémoire.

import { decode, encode, verifySignature, type SubmittableTransaction, type Transaction } from "xrpl";

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
