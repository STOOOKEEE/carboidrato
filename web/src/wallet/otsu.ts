// Fournisseur injecté par l'extension Otsu (`window.xrpl`, `isOtsu: true`) : seules les méthodes dont Bari se sert.

export interface OtsuProvider {
  isOtsu: true;
  connect(): Promise<{ address: string }>;
  getAddress(): Promise<{ address: string }>;
  /** Identifiant du réseau courant d'Otsu : `mainnet`, `testnet`, `devnet`, `alphanet` ou `custom-…`. */
  getNetwork(): Promise<{ network: string }>;
  /** Complète (autofill sur le réseau du wallet, `Account` = compte actif) puis signe, sans soumettre. */
  signTransaction(tx: Record<string, unknown>): Promise<{ tx_blob: string; hash: string }>;
}

declare global {
  interface Window {
    xrpl?: Partial<OtsuProvider> & { isOtsu?: boolean };
  }
}

/** Le fournisseur Otsu de la page, undefined sans l'extension (ou avec un autre wallet). */
export function otsuProvider(): OtsuProvider | undefined {
  const provider = window.xrpl;
  return provider?.isOtsu === true ? (provider as OtsuProvider) : undefined;
}
