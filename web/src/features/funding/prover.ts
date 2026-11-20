// Preuve Groth16 calculée dans le navigateur (snarkjs) avec le wasm et la zkey servis par l'API, et contrôle de
// la signature du débiteur par le seul calcul du témoin. Le témoin et l'aléa r ne quittent jamais cette page.

import { groth16, wtns } from "snarkjs";
import type { AttestedInvoiceFile, CertificateRequest, PublicDebtor } from "../../../../src/api/contract";
import { buildCircuitInput, signatureCheckInput } from "./witness";

/** 31 octets : r reste sous l'ordre du sous-groupe BN254 (254 bits). */
const BLINDING_BYTES = 31;

export interface ProverArtifacts {
  /** URL dans le navigateur, chemin de fichier sous Node. */
  wasm: string;
  zkey: string;
}

export interface ProofRequest {
  file: AttestedInvoiceFile;
  debtors: readonly PublicDebtor[];
  threshold: bigint;
  vintage: bigint;
}

export interface BrowserProof extends CertificateRequest {
  durationMs: number;
}

/** Aléa r de l'engagement C, tiré par le générateur cryptographique du navigateur. */
export function randomBlinding(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(BLINDING_BYTES));
  return BigInt(`0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`);
}

/** Le circuit vérifie la signature EdDSA : un témoin impossible à calculer signale une attestation falsifiée. */
export async function signatureIsValid(file: AttestedInvoiceFile, wasm: string): Promise<boolean> {
  try {
    await wtns.calculate(signatureCheckInput(file), wasm, { type: "mem" });
    return true;
  } catch {
    return false;
  }
}

export async function proveInvoice(request: ProofRequest, artifacts: ProverArtifacts): Promise<BrowserProof> {
  const input = buildCircuitInput({ ...request, blinding: randomBlinding() });
  const startedAt = performance.now();
  const { proof, publicSignals } = await groth16.fullProve(input, artifacts.wasm, artifacts.zkey);
  return {
    proof: { pi_a: proof.pi_a, pi_b: proof.pi_b, pi_c: proof.pi_c, protocol: proof.protocol, curve: proof.curve },
    publicSignals,
    durationMs: performance.now() - startedAt,
  };
}
