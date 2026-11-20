// Domaine permissionné des prêteurs (XLS-80) : KYC_INVESTOR émis par kyb_issuer.

import type { Client, Wallet } from "xrpl";
import { textToHex } from "../lib/encoding.js";
import { createdLedgerIndex } from "../xrpl/meta.js";
import { submitTx } from "../xrpl/submit.js";
import { CREDENTIAL_TYPES } from "./kycCredentials.js";

export async function createLenderDomain(client: Client, bari: Wallet, kybIssuer: string): Promise<string> {
  const outcome = await submitTx(
    client,
    {
      TransactionType: "PermissionedDomainSet",
      Account: bari.address,
      AcceptedCredentials: [
        { Credential: { Issuer: kybIssuer, CredentialType: textToHex(CREDENTIAL_TYPES.kycInvestor) } },
      ],
    },
    bari,
    "PermissionedDomainSet (prêteurs)",
  );
  return createdLedgerIndex(outcome.meta, "PermissionedDomain");
}
