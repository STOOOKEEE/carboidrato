// Signature dans Otsu d'une transaction préparée par Bari (jamais soumise par le wallet) : refus et délai dépassé
// deviennent `WalletRejected`, pour que chaque parcours affiche la même solution.

import type { OtsuProvider } from "./otsu";

/** Codes d'Otsu (`ErrorCodes`) quand l'utilisateur refuse ou laisse expirer la fenêtre de signature. */
export const REJECTED = /SIGNING_REJECTED|USER_REJECTED|SIGNING_TIMEOUT|rejected/i;

/** L'utilisateur a refusé la demande dans Otsu, ou l'a laissée expirer. */
export class WalletRejected extends Error {
  constructor() {
    super("The request was declined in Otsu.");
  }
}

/** Blob signé de `tx` ; lève `WalletRejected` sur un refus, une erreur explicite sans Otsu. */
export async function signWithOtsu(provider: OtsuProvider | undefined, tx: Record<string, unknown>): Promise<string> {
  if (provider === undefined) throw new Error("Otsu wallet is not available in this browser.");
  try {
    return (await provider.signTransaction(tx)).tx_blob;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (REJECTED.test(message)) throw new WalletRejected();
    throw cause instanceof Error ? cause : new Error(message);
  }
}
