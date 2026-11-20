// Certificat à partir d'une preuve reçue (navigateur) ou calculée par le serveur : Bari vérifie la preuve pour les
// valeurs attendues du fonds avant de l'encoder dans les métadonnées du MPT facture.

import type { InvoiceCertificate } from "../../invoice/certificate.js";
import { encodeCertificateMetadata, GROTH16_PROOF_SYSTEM } from "../../invoice/certificateMetadata.js";
import { loanTerms } from "../../lending/loanTerms.js";
import { PUBLIC_SIGNAL_ORDER, statementHex, verify, type InvoiceProof } from "../../zk/index.js";
import { HttpError } from "./errors.js";
import type { ProofExpectations } from "./zkInputs.js";

const HTTP_UNPROCESSABLE = 422;
const MS_PER_SECOND = 1_000;
const DUE_DATE_SIGNAL_INDEX = PUBLIC_SIGNAL_ORDER.indexOf("dueDate");

/** Échéance prouvée : publique, propre à la facture ; elle doit être future. */
function provenDueDate(proof: InvoiceProof): bigint {
  const raw = proof.publicSignals[DUE_DATE_SIGNAL_INDEX];
  const dueDate = raw === undefined ? undefined : BigInt(raw);
  if (dueDate === undefined || dueDate <= BigInt(Math.floor(Date.now() / MS_PER_SECOND))) {
    throw new HttpError(HTTP_UNPROCESSABLE, "Échéance prouvée absente ou passée");
  }
  return dueDate;
}

export async function certificateFromProof(proof: InvoiceProof, expected: ProofExpectations): Promise<InvoiceCertificate> {
  const result = await verify(proof, {
    debtorsRoot: expected.debtorsRoot,
    account: expected.smeAccount,
    threshold: loanTerms().provenThresholdCents,
    dueDate: provenDueDate(proof),
    networkId: expected.networkId,
    registry: expected.registry,
    vintage: expected.vintage,
  });
  if (!result.valid) throw new HttpError(HTTP_UNPROCESSABLE, `Preuve refusée : ${result.reason}`);
  return {
    ...statementHex(result.statement),
    proofSystem: GROTH16_PROOF_SYSTEM,
    metadataHex: encodeCertificateMetadata(proof),
  };
}
