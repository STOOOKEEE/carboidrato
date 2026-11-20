// Credentials KYC/KYB (XLS-70) : émission + acceptation, idempotentes pour rejouer le scénario avec les mêmes comptes.

import type { Client, Wallet } from "xrpl";
import { textToHex } from "../lib/encoding.js";
import { log } from "../lib/logger.js";
import { getCredential, isCredentialAccepted } from "../xrpl/ledgerEntries.js";
import { submitTx } from "../xrpl/submit.js";

export const CREDENTIAL_TYPES = {
  kycInvestor: "KYC_INVESTOR",
  kybSme: "KYB_PME",
} as const;

export interface CredentialRequest {
  issuer: Wallet;
  subject: Wallet;
  subjectName: string;
  type: string;
  uriHex?: string;
}

function acceptCredential(client: Client, request: CredentialRequest, typeHex: string) {
  return submitTx(
    client,
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

/** Garantit un credential émis et accepté par son sujet. */
export async function ensureCredential(client: Client, request: CredentialRequest): Promise<void> {
  const { issuer, subject, subjectName, type, uriHex } = request;
  const typeHex = textToHex(type);
  const existing = await getCredential(client, subject.address, issuer.address, typeHex);
  if (existing !== undefined && isCredentialAccepted(existing)) {
    log.info(`credential ${type} de ${subjectName} déjà valide et accepté (réutilisé)`);
    return;
  }
  if (existing === undefined) {
    await submitTx(
      client,
      {
        TransactionType: "CredentialCreate",
        Account: issuer.address,
        Subject: subject.address,
        CredentialType: typeHex,
        ...(uriHex === undefined ? {} : { URI: uriHex }),
      },
      issuer,
      `CredentialCreate ${type} → ${subjectName}`,
    );
  }
  await acceptCredential(client, request, typeHex);
}
