// Transaction que l'utilisateur signe dans son wallet (Otsu) : demande de signature renvoyée au front, retour du blob
// signé contrôlé contre la transaction préparée, soumission qui demande de recommencer si elle arrive trop tard.

import { decode, encode, type SubmittableTransaction } from "xrpl";
import { EXPIRED_RESULT, matchesPrepared, type PreparedStore, type WalletTxPorts } from "../../xrpl/preparedTx.js";
import { UnexpectedTxResult } from "../../xrpl/submit.js";
import type { OnboardingTx, PreparedSignature } from "../contract.js";
import { HttpError } from "./errors.js";

const HTTP_BAD_REQUEST = 400;
const HTTP_CONFLICT = 409;

/** Ce que le front fait signer dans Otsu : la transaction préparée en JSON, et ce qu'elle fait. */
export function signatureRequest(tx: SubmittableTransaction, labels: string[], transactions: OnboardingTx[] = []): PreparedSignature {
  return { status: "sign", tx: decode(encode(tx)), labels, transactions };
}

/** Transaction préparée pour `key` dont `txBlob` est la signature exacte ; elle est alors oubliée (séquence consommée). */
export function takeSigned<T extends { tx: SubmittableTransaction }>(store: PreparedStore<T>, key: string, txBlob: string): T {
  const pending = store.get(key);
  if (pending === undefined) throw new HttpError(HTTP_CONFLICT, "Nothing is waiting for your signature. Start again.");
  if (!matchesPrepared(pending.tx, txBlob)) {
    throw new HttpError(HTTP_BAD_REQUEST, "This is not the transaction Bari prepared. Start again.");
  }
  store.delete(key);
  return pending;
}

/** Soumission du blob signé ; arrivé après son échéance, il n'entrera jamais dans le ledger : 409, à recommencer. */
export function submitBeforeExpiry(ports: Pick<WalletTxPorts, "submitSigned">): Pick<WalletTxPorts, "submitSigned"> {
  return {
    submitSigned: (txBlob, hash, label) =>
      ports.submitSigned(txBlob, hash, label).catch((error: unknown) => {
        if (error instanceof UnexpectedTxResult && error.result.startsWith(EXPIRED_RESULT)) {
          throw new HttpError(HTTP_CONFLICT, "This request expired before it reached the ledger. Start again.");
        }
        throw error;
      }),
  };
}
