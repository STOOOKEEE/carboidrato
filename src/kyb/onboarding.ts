// Ouverture du compte XRPL géré d'un nouvel utilisateur, par rôle : compte financé, credential KYC ou KYB émis par
// Bari pour un an et accepté, MPT du fonds autorisés. Un organisme public n'a pas de compte XRPL.

import { Wallet } from "xrpl";
import type { FundAccount } from "../accounts/funding.js";
import type { AccountProfile, ManagedAccount, ProvisionAccount } from "../accounts/userStore.js";
import { sha256Hex, textToHex } from "../lib/encoding.js";
import type { SubmitTx } from "../xrpl/submit.js";
import { CREDENTIAL_TYPES, CREDENTIAL_VALIDITY_S, issueCredential } from "./kycCredentials.js";

/** MPT du fonds ouvert : l'EURc (actif du Vault) et ses parts. */
export interface FundTokens {
  assetId: string;
  shareMptId: string;
}

export interface OnboardingDeps {
  submit: SubmitTx;
  fundAccount: FundAccount;
  /** Émetteur des credentials KYC_INVESTOR et KYB_PME, celui qu'exigent le domaine du Vault et les contrôles. */
  kycIssuer: Wallet;
  fund: () => FundTokens | undefined;
  /** Heure courante, en temps Ripple. */
  now: () => number;
}

type ManagedProfile = Exclude<AccountProfile, { role: "public_body" }>;

/** Dossier déclaré à l'inscription : seul son haché va sur le ledger (URI du credential). */
function dossierUri(address: string, account: ManagedProfile): string {
  const dossier = { account: address, ...account.profile, verification: "self-declared" };
  return textToHex(`sha256:${sha256Hex(JSON.stringify(dossier))}`);
}

export function makeProvisioner(deps: OnboardingDeps): ProvisionAccount {
  const authorize = (wallet: Wallet, issuanceId: string, label: string) =>
    deps.submit({ TransactionType: "MPTokenAuthorize", Account: wallet.address, MPTokenIssuanceID: issuanceId }, wallet, label);

  return async (account): Promise<ManagedAccount | undefined> => {
    if (account.role === "public_body") return undefined;
    const tokens = deps.fund();
    if (tokens === undefined) throw new Error("No fund is open on Bari yet: sign up again once it opens");

    const wallet = Wallet.generate();
    if (wallet.seed === undefined) throw new Error("Wallet généré sans seed");
    await deps.fundAccount(wallet, account.role);
    await issueCredential(deps.submit, {
      issuer: deps.kycIssuer,
      subject: wallet,
      subjectName: account.role,
      type: account.role === "lender" ? CREDENTIAL_TYPES.kycInvestor : CREDENTIAL_TYPES.kybSme,
      uriHex: dossierUri(wallet.address, account),
      expiration: deps.now() + CREDENTIAL_VALIDITY_S,
    });
    await authorize(wallet, tokens.assetId, `MPTokenAuthorize EURc (${account.role})`);
    if (account.role === "lender") await authorize(wallet, tokens.shareMptId, "MPTokenAuthorize Vault shares (lender)");
    return { address: wallet.address, seed: wallet.seed };
  };
}
