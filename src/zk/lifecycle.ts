// Libération des ressources de snarkjs : la courbe BN254 partagée lance des workers qui empêchent Node de quitter.

/** Nom de la courbe mise en cache par ffjavascript sur globalThis. */
const CURVE_CACHE_KEY = "curve_bn128";

/** À appeler une fois toutes les preuves et vérifications terminées (fin de script ou de tests). */
export async function releaseZkResources(): Promise<void> {
  const curve: unknown = Reflect.get(globalThis, CURVE_CACHE_KEY);
  if (typeof curve === "object" && curve !== null && "terminate" in curve && typeof curve.terminate === "function") {
    await curve.terminate();
  }
}
