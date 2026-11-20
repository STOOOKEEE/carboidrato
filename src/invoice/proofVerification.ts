// Vérification cryptographique de la preuve d'un certificat (Groth16, clé de vérification publique).
// La confrontation des entrées publiques au ledger (compte, racine, registre, millésime, networkId, N, P)
// est faite par l'appelant (fund/invoiceInspection.ts) ; ici, on vérifie que la preuve tient pour ces valeurs.

import { fromHex, verify } from "../zk/index.js";
import type { CertificateMetadata } from "./certificateMetadata.js";

export type ProofVerdict = { status: "valid" } | { status: "invalid"; reason: string };

export async function verifyInvoiceProof(certificate: CertificateMetadata): Promise<ProofVerdict> {
  const result = await verify(certificate.proof, {
    debtorsRoot: fromHex(certificate.debtorsRoot),
    account: certificate.account,
    threshold: BigInt(certificate.thresholdCents),
    dueDate: BigInt(certificate.dueDate),
    networkId: certificate.networkId,
    registry: certificate.registry,
    vintage: BigInt(certificate.vintage),
  });
  return result.valid ? { status: "valid" } : { status: "invalid", reason: result.reason };
}

export function describeVerdict(verdict: ProofVerdict): string {
  return verdict.status === "valid" ? "preuve Groth16 : valide" : `preuve Groth16 : INVALIDE (${verdict.reason})`;
}
