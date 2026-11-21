// Credentials KYC/KYB (XLS-70) : émission + acceptation, idempotentes pour rejouer le scénario avec les mêmes comptes.

import type { Client, Wallet } from "xrpl";
import { textToHex } from "../lib/encoding.js";
import { log } from "../lib/logger.js";
import { getCredential, isCredentialAccepted } from "../xrpl/ledgerEntries.js";
import { clientSubmitter, type SubmitTx } from "../xrpl/submit.js";

export const CREDENTIAL_TYPES = {
  kycInvestor: "KYC_INVESTOR",
  kybSme: "KYB_PME",
} as const;

/** Durée de validité d'un credential KYC/KYB émis à l'inscription : un an. */
export const CREDENTIAL_VALIDITY_S = 365 * 86_400;

export interface CredentialRequest {
  issuer: Wallet;
  subject: Wallet;
  subjectName: string;
  type: string;
  uriHex?: string;
  /** Fin de validité (temps Ripple) ; sans elle, le credential n'expire pas. */
  expiration?: number;
}

function createCredential(submit: SubmitTx, request: CredentialRequest, typeHex: string) {
  const { issuer, subject, subjectName, type, uriHex, expiration } = request;
  return submit(
    {
      TransactionType: "CredentialCreate",
      Account: issuer.address,
      Subject: subject.address,
      CredentialType: typeHex,
      ...(uriHex === undefined ? {} : { URI: uriHex }),
      ...(expiration === undefined ? {} : { Expiration: expiration }),
    },
    issuer,
    `CredentialCreate ${type} → ${subjectName}`,
  );
}

function acceptCredential(submit: SubmitTx, request: CredentialRequest, typeHex: string) {
  return submit(
    {
      TransactionType: "CredentialAccept",
      Account: request.subject.address,
      Issuer: request.issuer.address,
      CredentialType: typeHex,
    },
    request.subject,
    `CredentialAccept ${request.type} (${request.subjectName})`,
  );
}

/** Émet un credential à un compte qui n'en a pas encore, puis le fait accepter par son sujet. */
export async function issueCredential(submit: SubmitTx, request: CredentialRequest): Promise<void> {
  const typeHex = textToHex(request.type);
  await createCredential(submit, request, typeHex);
  await acceptCredential(submit, request, typeHex);
}

/** Garantit un credential émis et accepté par son sujet. */
export async function ensureCredential(client: Client, request: CredentialRequest): Promise<void> {
  const { issuer, subject, subjectName, type } = request;
  const typeHex = textToHex(type);
  const submit = clientSubmitter(client);
  const existing = await getCredential(client, subject.address, issuer.address, typeHex);
  if (existing !== undefined && isCredentialAccepted(existing)) {
    log.info(`credential ${type} de ${subjectName} déjà valide et accepté (réutilisé)`);
    return;
  }
  if (existing === undefined) await createCredential(submit, request, typeHex);
  await acceptCredential(submit, request, typeHex);
}
