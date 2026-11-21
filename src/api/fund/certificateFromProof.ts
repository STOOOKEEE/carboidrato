// Certificat à partir d'une preuve reçue du navigateur : Bari vérifie la preuve pour les valeurs attendues du fonds et
// du compte de l'entreprise, avec un seuil qui doit être un palier public, avant de l'encoder dans les métadonnées du MPT facture.

import type { InvoiceCertificate } from "../../invoice/certificate.js";
import { encodeCertificateMetadata, GROTH16_PROOF_SYSTEM } from "../../invoice/certificateMetadata.js";
import { isOfferTier } from "../../lending/loanTerms.js";
import { PUBLIC_SIGNAL_ORDER, statementHex, verify, type InvoiceProof } from "../../zk/index.js";
import { HttpError } from "./errors.js";
import type { ProofExpectations } from "./zkInputs.js";

const HTTP_UNPROCESSABLE = 422;
const MS_PER_SECOND = 1_000;
const DUE_DATE_SIGNAL_INDEX = PUBLIC_SIGNAL_ORDER.indexOf("dueDate");
const THRESHOLD_SIGNAL_INDEX = PUBLIC_SIGNAL_ORDER.indexOf("threshold");

/** Signal public de la preuve (le schéma de la route en garantit le nombre et le format décimal). */
function publicSignal(proof: InvoiceProof, index: number): bigint {
  return BigInt(proof.publicSignals[index] ?? "0");
}

export async function certificateFromProof(proof: InvoiceProof, expected: ProofExpectations): Promise<InvoiceCertificate> {
  // Échéance prouvée : publique, propre à la facture ; elle doit être future.
  const dueDate = publicSignal(proof, DUE_DATE_SIGNAL_INDEX);
  if (dueDate <= BigInt(Math.floor(Date.now() / MS_PER_SECOND))) {
    throw new HttpError(HTTP_UNPROCESSABLE, "The proven due date is missing or past");
  }
  // Seul le palier devient public : un autre seuil en dirait plus sur le montant de la facture.
  const threshold = publicSignal(proof, THRESHOLD_SIGNAL_INDEX);
  if (!isOfferTier(threshold)) throw new HttpError(HTTP_UNPROCESSABLE, "The proven threshold must be one of the public tiers");
  const result = await verify(proof, {
    debtorsRoot: expected.debtorsRoot,
    account: expected.smeAccount,
    threshold,
    dueDate,
    networkId: expected.networkId,
    registry: expected.registry,
    vintage: expected.vintage,
  });
  if (!result.valid) throw new HttpError(HTTP_UNPROCESSABLE, `Proof rejected: ${result.reason}`);
  return {
    ...statementHex(result.statement),
    proofSystem: GROTH16_PROOF_SYSTEM,
    metadataHex: encodeCertificateMetadata(proof),
  };
}
