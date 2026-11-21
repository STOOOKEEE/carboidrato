// Branchement de l'espace organisme public sur l'API : clés d'attestation de la session et recherche du fournisseur
// par son n° de TVA. La facture n'y part jamais : la signature (chargée à la demande) se fait dans cette page.

import type { AttestedInvoiceFile, BusinessLookup, PublicBodyKeys } from "../../../../src/api/contract";
import { fetchProofParams, request } from "../../api";
import { parseJsonOrUndefined } from "../../json";
import type { InvoiceDraft } from "./publicBody.machine";

const HTTP_NOT_FOUND = 404;

/** Fournisseur inscrit sur Bari sous ce n° de TVA, undefined s'il n'a pas de compte. */
export async function findSupplier(vat: string): Promise<BusinessLookup | undefined> {
  const response = await fetch(`/api/businesses/by-vat/${encodeURIComponent(vat)}`);
  if (response.status === HTTP_NOT_FOUND) return undefined;
  const payload = parseJsonOrUndefined(await response.text()) as Partial<BusinessLookup & { error: string }> | undefined;
  if (!response.ok || payload === undefined) {
    throw new Error(payload?.error ?? `Bari API unavailable (HTTP ${response.status}). Try again in a moment.`);
  }
  return payload as BusinessLookup;
}

/** Signe la facture dans cet onglet avec les clés de l'organisme, liée au compte du fournisseur et au registre de Bari. */
export async function signInvoice(draft: InvoiceDraft, supplier: BusinessLookup): Promise<AttestedInvoiceFile> {
  const [{ attestInvoice }, keys, params] = await Promise.all([
    import("./attest"),
    request<PublicBodyKeys>("/api/public-body/keys"),
    fetchProofParams(),
  ]);
  return attestInvoice({
    keys,
    supplierAccount: supplier.address,
    invoice: {
      number: draft.number,
      issueDate: draft.issueDate,
      amountCents: draft.amountCents,
      dueDate: draft.dueDate,
      description: draft.description,
    },
    networkId: params.networkId,
    registry: params.registry,
  });
}
