// Ouverture du compte XRPL géré d'un nouvel utilisateur, par rôle : compte financé, credential KYC ou KYB émis par
// Bari pour un an et accepté, ligne de confiance RLUSD (et parts du Vault pour un prêteur). Un organisme public n'a pas
// de compte XRPL.

import { Wallet, type MPTokenAuthorize, type TrustSet } from "xrpl";
import type { FundAccount } from "../accounts/funding.js";
import type { AccountProfile, ManagedAccount, ProvisionAccount } from "../accounts/userStore.js";
import { sha256Hex, textToHex } from "../lib/encoding.js";
import type { Ledger } from "../xrpl/ledger.js";
import { trustLine, type Stablecoin } from "../xrpl/stablecoin.js";
import type { SubmitTx } from "../xrpl/submit.js";
import { CREDENTIAL_TYPES, CREDENTIAL_VALIDITY_S, issueCredential } from "./kycCredentials.js";

/** Jetons du fonds ouvert : le RLUSD (actif du Vault) et les parts du Vault. */
export interface FundTokens {
  stablecoin: Stablecoin;
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
type ManagedRole = ManagedProfile["role"];

function shareAuthorization(tokens: FundTokens, holder: string): MPTokenAuthorize {
  return { TransactionType: "MPTokenAuthorize", Account: holder, MPTokenIssuanceID: tokens.shareMptId };
}

/**
 * Jetons du fonds courant que le compte ne détient pas encore (compte ouvert pour un fonds précédent) : transactions
 * à signer par le compte, ligne de confiance RLUSD puis parts du Vault pour un prêteur.
 */
export async function missingHoldings(
  ledger: Pick<Ledger, "accountObjects">,
  tokens: FundTokens,
  holder: string,
  role: ManagedRole,
): Promise<(TrustSet | MPTokenAuthorize)[]> {
  const { currency, issuer } = tokens.stablecoin;
  const lines = await ledger.accountObjects(holder, "state");
  const hasTrustLine = lines.some(
    (entry) =>
      entry.LedgerEntryType === "RippleState" &&
      [entry.HighLimit, entry.LowLimit].some((limit) => limit.currency === currency && limit.issuer === issuer),
  );
  const missing: (TrustSet | MPTokenAuthorize)[] = hasTrustLine ? [] : [trustLine(tokens.stablecoin, holder)];
  if (role !== "lender") return missing;
  const holdings = await ledger.accountObjects(holder, "mptoken");
  // xrpl.js ne type pas l'objet MPToken : le champ est lu après vérification.
  const wanted = tokens.shareMptId.toUpperCase();
  const holdsShares = holdings.some(
    (entry) => "MPTokenIssuanceID" in entry && typeof entry.MPTokenIssuanceID === "string" && entry.MPTokenIssuanceID.toUpperCase() === wanted,
  );
  return holdsShares ? missing : [...missing, shareAuthorization(tokens, holder)];
}

/** Dossier déclaré à l'inscription : seul son haché va sur le ledger (URI du credential). */
function dossierUri(address: string, account: ManagedProfile): string {
  const dossier = { account: address, ...account.profile, verification: "self-declared" };
  return textToHex(`sha256:${sha256Hex(JSON.stringify(dossier))}`);
}

export function makeProvisioner(deps: OnboardingDeps): ProvisionAccount {
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
    await deps.submit(trustLine(tokens.stablecoin, wallet.address), wallet, `TrustSet RLUSD (${account.role})`);
    if (account.role === "lender") await deps.submit(shareAuthorization(tokens, wallet.address), wallet, "MPTokenAuthorize Vault shares (lender)");
    return { address: wallet.address, seed: wallet.seed };
  };
}
