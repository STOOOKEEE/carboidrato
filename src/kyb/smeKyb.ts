// KYB de la PME, simulé : dossier hors chaîne haché, credential KYB_PME émis par le prestataire KYB.

import type { Client } from "xrpl";
import type { Actors } from "../accounts/actors.js";
import { sha256Hex, textToHex } from "../lib/encoding.js";
import { log } from "../lib/logger.js";
import type { Ledger } from "../xrpl/ledger.js";
import { isCredentialAccepted } from "../xrpl/ledgerEntries.js";
import { CREDENTIAL_TYPES, ensureCredential } from "./kycCredentials.js";

/** Dossier simulé (en production : registre des entreprises, KYC du représentant légal, bénéficiaires effectifs). */
function buildKybDossier(smeAddress: string) {
  return {
    account: smeAddress,
    company: "Marco Costruzioni S.r.l. (démo)",
    legalRepresentativeKyc: "ok",
    beneficialOwners: "ok",
    sanctions: "aucune",
  };
}

/** Émet KYB_PME (URI = hash du dossier) et le fait accepter par la PME. */
export async function onboardSme(client: Client, actors: Actors): Promise<void> {
  const dossierHash = sha256Hex(JSON.stringify(buildKybDossier(actors.sme.address)));
  log.info(`dossier KYB haché : sha256:${dossierHash}`);
  await ensureCredential(client, {
    issuer: actors.kyb_issuer,
    subject: actors.sme,
    subjectName: "sme",
    type: CREDENTIAL_TYPES.kybSme,
    uriHex: textToHex(`sha256:${dossierHash}`),
  });
}

/** KYB fait : credential KYB_PME émis par le prestataire et accepté par la PME. */
export async function isSmeKybDone(ledger: Ledger, smeAddress: string, kybIssuer: string): Promise<boolean> {
  const kyb = await ledger.credential(smeAddress, kybIssuer, textToHex(CREDENTIAL_TYPES.kybSme));
  return kyb !== undefined && isCredentialAccepted(kyb);
}
