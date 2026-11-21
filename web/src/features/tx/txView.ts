// Page transaction : états de chargement et textes affichés, sans React.

import type { TxCertificate, TxDetail } from "../../../../src/api/contract";
import { formatDate, formatUsd } from "../../format";

const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const HASH_PATTERN = /^[0-9A-F]{64}$/i;
const SUCCESS = "tesSUCCESS";
const CENTS_PER_USD = 100;
const MS_PER_SECOND = 1_000;

export type TxView =
  | { status: "invalid" }
  | { status: "loading" }
  | { status: "ready"; detail: TxDetail }
  | { status: "notFound" }
  | { status: "error"; message: string };

export interface Fact {
  label: string;
  value: string;
}

const EXPLANATIONS: Record<string, string> = {
  Batch: "Several transactions applied together, all or nothing.",
  AccountSet: "Changes an account's settings, for example letting an issued token move between its holders.",
  CredentialCreate: "Issues an on-ledger credential: a KYB check, or an invoice fingerprint in Bari's registry.",
  CredentialAccept: "The account accepts a credential issued to it.",
  MPTokenIssuanceCreate: "Creates a token. Bari's invoice token carries the zero-knowledge proof in its metadata.",
  MPTokenAuthorize: "Lets an account hold a token.",
  TrustSet: "Opens a trust line so the account can hold an issued token such as RLUSD.",
  Payment: "Moves funds or tokens between two accounts.",
  LoanSet: "Opens a loan from the fund. Its Data field points to the invoice certificate.",
  LoanPay: "Repays a loan.",
  LoanManage: "Changes a loan's status, for example a default.",
  LoanBrokerSet: "Sets up the fund's loan broker.",
  LoanBrokerCoverDeposit: "Adds first-loss cover to the fund.",
  VaultCreate: "Opens the fund's vault.",
  VaultDeposit: "An investor deposits into the fund.",
  VaultWithdraw: "An investor withdraws from the fund.",
};

export function initialTxView(hash: string): TxView {
  return HASH_PATTERN.test(hash) ? { status: "loading" } : { status: "invalid" };
}

export function txViewFromResponse(status: number, payload: unknown): TxView {
  if (status === HTTP_OK && typeof payload === "object" && payload !== null) {
    return { status: "ready", detail: payload as TxDetail };
  }
  if (status === HTTP_NOT_FOUND) return { status: "notFound" };
  const message =
    typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string"
      ? payload.error
      : `Bari API unavailable (HTTP ${status}).`;
  return { status: "error", message };
}

export function txTitle({ type, result, validated }: TxDetail): string {
  if (!validated) return `${type} not validated yet`;
  return result === SUCCESS ? `${type} succeeded` : `${type} failed (${result ?? "no result"})`;
}

export const txExplanation = (type: string) => EXPLANATIONS[type] ?? "A transaction on the XRP Ledger.";

export function keyFacts(detail: TxDetail): Fact[] {
  return [
    ...(detail.result === undefined ? [] : [{ label: "Result", value: detail.result }]),
    ...(detail.ledgerIndex === undefined ? [] : [{ label: "Ledger", value: String(detail.ledgerIndex) }]),
    ...(detail.closeTime === undefined ? [] : [{ label: "Closed", value: detail.closeTime }]),
    ...detail.accounts.map(({ role, address }) => ({ label: role, value: address })),
    ...detail.fields.map(({ name, value }) => ({ label: name, value })),
  ];
}

export function certificateFacts(certificate: TxCertificate): Fact[] {
  return [
    { label: "Proof system", value: certificate.proofSystem === "groth16" ? "Groth16" : certificate.proofSystem },
    { label: "Proven minimum amount", value: formatUsd(certificate.thresholdCents / CENTS_PER_USD) },
    { label: "Due date", value: formatDate(new Date(certificate.dueDate * MS_PER_SECOND).toISOString()) },
    { label: "Invoice fingerprint N", value: certificate.nullifier },
    { label: "Commitment C", value: certificate.commitment },
    { label: "Debtor pseudonym P", value: certificate.pseudonym },
    { label: "Verified debtors root", value: certificate.debtorsRoot },
    { label: "Proven account", value: certificate.account },
    { label: "Registry", value: certificate.registry },
    { label: "Network ID", value: String(certificate.networkId) },
    { label: "Vintage", value: String(certificate.vintage) },
  ];
}
