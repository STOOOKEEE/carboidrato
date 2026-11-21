// Vérification Groth16 dans le navigateur du visiteur (snarkjs), avec la clé publique servie par l'API.

import { groth16 } from "snarkjs";
import type { ProofVerifier } from "./transparency";

export function browserVerifier(verificationKey: unknown): ProofVerifier {
  return ({ proof, publicSignals }) => groth16.verify(verificationKey, publicSignals, proof);
}
