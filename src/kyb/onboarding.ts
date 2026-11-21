// Ouverture du compte XRPL d'un nouvel utilisateur, par rôle : credential KYC ou KYB émis par Bari pour un an et
// accepté, ligne de confiance RLUSD (et parts du Vault pour un prêteur). Compte géré : Bari le finance et signe tout.
// Wallet de l'utilisateur : Bari émet le credential, l'utilisateur signe le reste lui-même. Un organisme public n'a pas
// de compte XRPL.

import {
  BatchFlags,
  GlobalFlags,
  Wallet,
  type Batch,
  type CredentialAccept,
  type CredentialCreate,
  type LedgerEntry,
  type MPTokenAuthorize,
  type SubmittableTransaction,
  type TrustSet,
} from "xrpl";
import type { FundAccount } from "../accounts/funding.js";
import type { AccountProfile, ManagedAccount, ProvisionAccount } from "../accounts/userStore.js";
import { sha256Hex, textToHex } from "../lib/encoding.js";
import type { Ledger } from "../xrpl/ledger.js";
import { isCredentialAccepted } from "../xrpl/ledgerEntries.js";
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

export type ManagedProfile = Exclude<AccountProfile, { role: "public_body" }>;
type ManagedRole = ManagedProfile["role"];

export const ROLE_CREDENTIALS: Record<ManagedRole, string> = {
  lender: CREDENTIAL_TYPES.kycInvestor,
  business: CREDENTIAL_TYPES.kybSme,
};

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
    if (tokens === undefined) throw new Error("No fund is open on Atlas yet: sign up again once it opens");

    const wallet = Wallet.generate();
    if (wallet.seed === undefined) throw new Error("Wallet généré sans seed");
    await deps.fundAccount(wallet, account.role);
    await issueCredential(deps.submit, {
      issuer: deps.kycIssuer,
      subject: wallet,
      subjectName: account.role,
      type: ROLE_CREDENTIALS[account.role],
      uriHex: dossierUri(wallet.address, account),
      expiration: deps.now() + CREDENTIAL_VALIDITY_S,
    });
    await deps.submit(trustLine(tokens.stablecoin, wallet.address), wallet, `TrustSet RLUSD (${account.role})`);
    if (account.role === "lender") await deps.submit(shareAuthorization(tokens, wallet.address), wallet, "MPTokenAuthorize Vault shares (lender)");
    return { address: wallet.address, seed: wallet.seed };
  };
}

/** CredentialCreate de Bari pour le wallet d'un utilisateur : un an, URI = haché du dossier déclaré. */
export function credentialOffer(issuer: string, holder: string, account: ManagedProfile, now: number): CredentialCreate {
  return {
    TransactionType: "CredentialCreate",
    Account: issuer,
    Subject: holder,
    CredentialType: textToHex(ROLE_CREDENTIALS[account.role]),
    URI: dossierUri(holder, account),
    Expiration: now + CREDENTIAL_VALIDITY_S,
  };
}

/** Transaction que l'utilisateur signe dans son wallet, avec son libellé à l'écran. */
export interface UserStep {
  tx: SubmittableTransaction;
  label: string;
}

const ACCEPT_LABELS: Record<ManagedRole, string> = {
  lender: "Accept your KYC credential",
  business: "Accept your KYB credential",
};

const HOLDING_LABELS: Record<(TrustSet | MPTokenAuthorize)["TransactionType"], string> = {
  TrustSet: "Open your RLUSD trust line",
  MPTokenAuthorize: "Authorize vault shares",
};

/**
 * Ce qu'il reste à signer au wallet : l'acceptation du credential de Bari (absent = tout juste émis), puis les jetons
 * manquants du fonds.
 */
export function userSteps(
  issuer: string,
  holder: string,
  role: ManagedRole,
  credential: LedgerEntry.Credential | undefined,
  missing: readonly (TrustSet | MPTokenAuthorize)[],
): UserStep[] {
  const accept: CredentialAccept = {
    TransactionType: "CredentialAccept",
    Account: holder,
    Issuer: issuer,
    CredentialType: textToHex(ROLE_CREDENTIALS[role]),
  };
  const accepted = credential !== undefined && isCredentialAccepted(credential);
  return [
    ...(accepted ? [] : [{ tx: accept, label: ACCEPT_LABELS[role] }]),
    ...missing.map((tx) => ({ tx, label: HOLDING_LABELS[tx.TransactionType] })),
  ];
}

/**
 * Une seule signature pour tout : la transaction seule, ou un Batch tfAllOrNothing du seul compte (il faut au moins
 * deux transactions internes), sans BatchSigners. Les séquences internes suivent celle du Batch.
 */
export function userTransaction(
  holder: string,
  txs: readonly SubmittableTransaction[],
  sequence: number,
  lastLedgerSequence: number,
): SubmittableTransaction {
  if (txs.length === 0) throw new Error("Aucune transaction à signer");
  if (txs.length === 1) return { ...txs[0], Sequence: sequence, LastLedgerSequence: lastLedgerSequence };
  const batch: Batch = {
    TransactionType: "Batch",
    Account: holder,
    Flags: BatchFlags.tfAllOrNothing,
    Sequence: sequence,
    LastLedgerSequence: lastLedgerSequence,
    RawTransactions: txs.map((tx, index) => {
      if (tx.Flags !== undefined && typeof tx.Flags !== "number") throw new Error(`${tx.TransactionType} : Flags numériques attendus`);
      return {
        RawTransaction: {
          ...tx,
          Flags: (tx.Flags ?? 0) | GlobalFlags.tfInnerBatchTxn,
          Fee: "0",
          SigningPubKey: "",
          Sequence: sequence + 1 + index,
        },
      };
    }),
  };
  return batch;
}
