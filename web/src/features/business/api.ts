// Appels de l'espace entreprise : certificat à partir de la preuve, prêt co-signé, factures du compte. Rien du témoin.

import type { AttestedInvoiceFile, BusinessInvoice, CertificateRequest, PrecheckResponse } from "../../../../src/api/contract";
import { lookupRegistration, request } from "../../api";
import { parseJsonOrUndefined } from "../../json";
import { proveInBrowser } from "../funding/sources";
import { certificateOutcome, loanOutcome, type FundingServices } from "./business.effects";

/** Le statut compte ici : 409 (déjà enregistré) et 422 (refus de Bari) portent leurs détails. */
async function post(path: string, body: unknown): Promise<{ status: number; payload: unknown }> {
  const init = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  const response = await fetch(path, init).catch(() => {
    throw new Error("Bari did not answer. Check your connection, then try again.");
  });
  return { status: response.status, payload: parseJsonOrUndefined(await response.text()) };
}

export const fetchBusinessInvoices = () => request<BusinessInvoice[]>("/api/business/invoices");

/** Services de « Get paid now » pour une facture contrôlée : la preuve se calcule dans cet onglet. */
export function fundingServices(file: AttestedInvoiceFile, precheck: PrecheckResponse): FundingServices {
  return {
    prove: () => proveInBrowser(file),
    certify: async ({ proof, publicSignals }) => {
      // Seules la preuve et ses signaux publics sont recopiés : aucun autre champ ne peut partir par mégarde.
      const { status, payload } = await post("/api/sme/certificate", { proof, publicSignals } satisfies CertificateRequest);
      return certificateOutcome(status, payload);
    },
    registration: () => lookupRegistration(precheck.nullifier, file.attestation.account),
    borrow: async (tokenId) => {
      const { status, payload } = await post("/api/sme/loan", { tokenId });
      return loanOutcome(status, payload);
    },
  };
}
