// Contrôle d'un certificat de facture à partir du ledger : enregistrement de N, MPT facture, métadonnées,
// cohérence des entrées publiques avec le ledger (annexe C) et preuve. Partagé par Bari (avant de co-signer)
// et par l'audit du fonds.

import type { Client } from "xrpl";
import { decodeCertificateMetadata, type CertificateMetadata } from "../invoice/certificateMetadata.js";
import { verifyInvoiceProof, type ProofVerdict } from "../invoice/proofVerification.js";
import { INVOICE_TOKEN_SUPPLY } from "../invoice/invoiceToken.js";
import { getRegistration } from "../invoice/registry.js";
import { getMptBalance, getMptIssuance } from "../xrpl/ledgerEntries.js";
import type { FundManifest } from "./fundManifest.js";
import type { LoanReference } from "./loanData.js";

export interface InspectionContext {
  /** Emprunteur du prêt : doit être l'émetteur du credential N et du MPT facture. */
  borrower: string;
  bari: string;
  manifest: FundManifest;
  networkId: number | undefined;
}

export interface InvoiceInspection {
  /** Anomalies bloquantes (vide si le certificat est conforme). */
  problems: string[];
  certificate: CertificateMetadata | undefined;
  proof: ProofVerdict | undefined;
  heldByBari: boolean;
}

/** Entrées et sorties publiques du certificat confrontées au prêt et à la fiche du fonds. */
function publicInputMismatches(
  certificate: CertificateMetadata,
  reference: LoanReference,
  { borrower, manifest, networkId }: InspectionContext,
): string[] {
  const checks: ReadonlyArray<readonly [string, unknown, unknown]> = [
    ["compte prouvé (emprunteur)", certificate.account, borrower],
    ["N du prêt", certificate.nullifier, reference.nullifier],
    ["P du prêt", certificate.pseudonym, reference.pseudonym],
    ["racine des débiteurs du fonds", certificate.debtorsRoot, manifest.debtorsRoot],
    ["millésime du fonds", certificate.vintage, manifest.vintage],
    ["registre du fonds", certificate.registry, manifest.registry],
    ["networkId", certificate.networkId, networkId],
  ];
  return checks
    .filter(([, actual, expected]) => actual !== expected)
    .map(([label, actual, expected]) => `${label} : certificat ${String(actual)} ≠ attendu ${String(expected)}`);
}

export async function inspectInvoice(
  client: Client,
  reference: LoanReference,
  context: InspectionContext,
): Promise<InvoiceInspection> {
  const problems: string[] = [];
  const registration = await getRegistration(client, context.manifest.registry, context.borrower, reference.nullifier);
  if (registration === undefined) problems.push("credential N absent du registre (émetteur = emprunteur)");

  const issuance = await getMptIssuance(client, reference.invoiceTokenId);
  let certificate: CertificateMetadata | undefined;
  if (issuance === undefined) {
    problems.push("MPT facture introuvable");
  } else if (issuance.Issuer !== context.borrower) {
    problems.push(`MPT facture émis par ${issuance.Issuer}, pas par l'emprunteur`);
  } else if (issuance.MPTokenMetadata === undefined) {
    problems.push("MPT facture sans métadonnées");
  } else {
    try {
      certificate = decodeCertificateMetadata(issuance.MPTokenMetadata);
    } catch (error) {
      problems.push(`métadonnées illisibles : ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  let proof: ProofVerdict | undefined;
  if (certificate !== undefined) {
    problems.push(...publicInputMismatches(certificate, reference, context));
    proof = await verifyInvoiceProof(certificate);
    if (proof.status === "invalid") problems.push(`preuve invalide : ${proof.reason}`);
  }

  const heldByBari =
    issuance !== undefined &&
    (await getMptBalance(client, reference.invoiceTokenId, context.bari)) === INVOICE_TOKEN_SUPPLY;
  return { problems, certificate, proof, heldByBari };
}
