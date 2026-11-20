// Accès paresseux aux primitives circomlibjs (Poseidon, EdDSA-Poseidon sur BabyJubJub), identiques à celles du circuit.

import { buildEddsa, type Eddsa } from "circomlibjs";

let eddsaPromise: Promise<Eddsa> | undefined;

/** Instance unique : la construction charge du wasm et coûte ~100 ms. */
export function getEddsa(): Promise<Eddsa> {
  eddsaPromise ??= buildEddsa();
  return eddsaPromise;
}

/** Poseidon sur des entiers du corps, résultat en entier. */
export async function poseidon(inputs: bigint[]): Promise<bigint> {
  const eddsa = await getEddsa();
  return eddsa.F.toObject(eddsa.poseidon(inputs));
}
