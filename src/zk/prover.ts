// Calcul de la preuve Groth16 par la PME : l'attestation et le chemin Merkle restent privés.

import { groth16 } from "snarkjs";
import { BLINDING_BYTES, CIRCUIT_WASM_PATH, PROVING_KEY_PATH } from "./constants.js";
import type { DebtorAttestation } from "./debtor.js";
import { randomField } from "./field.js";
import type { MerklePath } from "./merkle.js";
import { parsePublicSignals, type InvoiceProof, type InvoiceStatement } from "./statement.js";

export interface ProveInput {
  attestation: DebtorAttestation;
  merklePath: MerklePath;
  /** Racine publiée de la liste (niveau de risque) à laquelle le débiteur appartient. */
  debtorsRoot: bigint;
  /** Seuil en centimes : la preuve établit montant ≥ seuil. */
  threshold: bigint;
  /** Millésime du fonds, portée du pseudonyme P. */
  vintage: bigint;
  /** Aléa r de l'engagement ; tiré au hasard si absent. */
  blinding?: bigint;
}

/** Ouverture de l'engagement C, gardée par la PME pour un éventuel litige. Ne jamais publier. */
export interface CommitmentOpening {
  message: bigint;
  blinding: bigint;
}

export interface ProvenInvoice extends InvoiceProof {
  statement: InvoiceStatement;
  opening: CommitmentOpening;
}

/**
 * Génère la preuve. Échoue (calcul du témoin) si l'énoncé est faux : signature invalide,
 * débiteur hors liste, montant < seuil… Aucune preuve ne peut alors exister.
 */
export async function prove(input: ProveInput): Promise<ProvenInvoice> {
  const { attestation, merklePath, debtorsRoot, threshold, vintage } = input;
  const blinding = input.blinding ?? randomField(BLINDING_BYTES);
  const witnessInput = {
    amount: attestation.amount,
    uuid: attestation.uuid,
    debtorAx: attestation.debtorPublicKey.ax,
    debtorAy: attestation.debtorPublicKey.ay,
    sigR8x: attestation.signature.r8x,
    sigR8y: attestation.signature.r8y,
    sigS: attestation.signature.s,
    pathElements: merklePath.pathElements,
    pathIndices: merklePath.pathIndices,
    blinding,
    debtorsRoot,
    account: attestation.account,
    threshold,
    dueDate: attestation.dueDate,
    networkId: attestation.networkId,
    registry: attestation.registry,
    vintage,
  };
  const { proof, publicSignals } = await groth16.fullProve(witnessInput, CIRCUIT_WASM_PATH, PROVING_KEY_PATH);
  return {
    proof,
    publicSignals,
    statement: parsePublicSignals(publicSignals),
    opening: { message: attestation.message, blinding },
  };
}
