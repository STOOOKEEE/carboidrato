// Branchement du pré-contrôle et de la preuve sur l'API du fonds : seules des données publiques en arrivent.
// Le prouveur (snarkjs) n'est chargé qu'au premier contrôle, pour ne pas alourdir la landing.

import type { AttestedInvoiceFile, PrecheckResponse } from "../../../../src/api/contract";
import { fetchDebtors, fetchKybStatus, fetchOffer, fetchProofParams, lookupRegistration } from "../../api";
import { runPrecheck } from "./precheck";
import type { BrowserProof } from "./prover";

export function precheckInBrowser(file: AttestedInvoiceFile): Promise<PrecheckResponse> {
  const params = fetchProofParams();
  return runPrecheck(file, {
    debtors: fetchDebtors,
    params: () => params,
    registration: lookupRegistration,
    kybDone: async (account) => (await fetchKybStatus(account)).done,
    offer: fetchOffer,
    signatureIsValid: async (candidate) => {
      const [{ signatureIsValid }, { artifacts }] = await Promise.all([import("./prover"), params]);
      return signatureIsValid(candidate, artifacts.wasm);
    },
    now: () => new Date(),
  });
}

/** Preuve Groth16 de la facture pour le fonds courant, calculée dans cet onglet. */
export async function proveInBrowser(file: AttestedInvoiceFile): Promise<BrowserProof> {
  const [{ proveInvoice }, debtors, params] = await Promise.all([import("./prover"), fetchDebtors(), fetchProofParams()]);
  return proveInvoice(
    { file, debtors, threshold: BigInt(params.thresholdCents), vintage: BigInt(params.vintage) },
    params.artifacts,
  );
}
