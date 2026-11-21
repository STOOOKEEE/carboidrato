// Machine d'état pure de l'espace entreprise : fichier signé, pré-contrôle et offre, financement, factures du compte.

import type { AttestedInvoiceFile, BusinessInvoice, CheckId, LoanCheck, PrecheckResponse } from "../../../../src/api/contract";
import { formatEur } from "../../format";
import { parseJsonOrUndefined } from "../../json";
import {
  initialFundingState,
  isFundingBusy,
  transition,
  type FundingEvent,
  type FundingLoan,
  type FundingState,
} from "../funding/funding.machine";
import { parseAttestedFile } from "../funding/precheck";

export type BusinessState =
  | { status: "empty" }
  | { status: "checking"; fileName: string }
  | { status: "unreadable"; message: string }
  | { status: "checked"; file: AttestedInvoiceFile; precheck: PrecheckResponse; funding: FundingState };

export type BusinessEvent =
  | { type: "FILE_DROPPED"; fileName: string }
  | { type: "FILE_CHECKED"; file: AttestedInvoiceFile; precheck: PrecheckResponse }
  | { type: "FILE_REJECTED"; message: string }
  | { type: "FUNDING"; event: FundingEvent };

export const initialBusinessState: BusinessState = Object.freeze({ status: "empty" });

export type SignedFileReading = { ok: true; file: AttestedInvoiceFile } | { ok: false; message: string };

/** Le fichier doit être une facture signée pour le compte de la session : la preuve est liée à ce compte. */
export function readSignedFile(text: string, account: string): SignedFileReading {
  const file = parseAttestedFile(parseJsonOrUndefined(text));
  if (file === undefined) {
    return { ok: false, message: "This is not a signed Bari invoice. Drop the .bari.json file your client sent you." };
  }
  if (file.attestation.account !== account) {
    return {
      ok: false,
      message: "This invoice was signed for another business account. Ask your client to sign it for your company on Bari.",
    };
  }
  return { ok: true, file };
}

export interface CheckRow {
  id: CheckId | "kyb";
  label: string;
  ok: boolean;
  detail: string;
}

const CHECK_TEXT: Record<CheckRow["id"], { label: string; ok: string; fail: string }> = {
  signature: {
    label: "Signature",
    ok: "Signed by your client, checked in this browser",
    fail: "The file changed after it was signed. Ask your client to sign it again.",
  },
  debtor: {
    label: "Public body",
    ok: "On Bari's list of verified public bodies",
    fail: "This public body is not on Bari's verified list, so Bari cannot finance its invoices.",
  },
  network: {
    label: "Network",
    ok: "Signed for Bari on this network",
    fail: "The file was signed for another network. Ask your client to sign it on Bari.",
  },
  amount: {
    label: "Amount",
    ok: "Covers at least the smallest tier of the offer",
    fail: "The invoice is below the smallest amount Bari finances.",
  },
  dueDate: {
    label: "Due date",
    ok: "Not due yet",
    fail: "The invoice is already due: ask your client to pay it.",
  },
  unique: {
    label: "Fingerprint",
    ok: "Never financed",
    fail: "Already financed: its fingerprint is already on the ledger.",
  },
  kyb: {
    label: "Your business",
    ok: "KYB_PME credential on your account",
    fail: "KYB_PME credential missing on your account: Bari cannot lend without it.",
  },
};

/** Contrôles du navigateur dans l'ordre du contrat, puis le KYB du compte. */
export function invoiceChecks(precheck: PrecheckResponse): CheckRow[] {
  const outcomes = [...precheck.checks, { id: "kyb" as const, ok: precheck.kyb.done }];
  return outcomes.map(({ id, ok }) => {
    const text = CHECK_TEXT[id];
    return { id, label: text.label, ok, detail: ok ? text.ok : text.fail };
  });
}

/** Raison qui empêche « Get paid now », undefined si l'offre est valable. */
export function getPaidBlocker(precheck: PrecheckResponse): string | undefined {
  const failed = invoiceChecks(precheck).find((row) => !row.ok);
  if (failed !== undefined) return failed.detail;
  return precheck.offer === undefined ? "Bari has no offer for this invoice." : undefined;
}

export function isBusy(state: BusinessState): boolean {
  return state.status === "checking" || (state.status === "checked" && isFundingBusy(state.funding));
}

export function businessTransition(state: BusinessState, event: BusinessEvent): BusinessState {
  switch (event.type) {
    case "FILE_DROPPED":
      return isBusy(state) ? state : { status: "checking", fileName: event.fileName };
    case "FILE_CHECKED": {
      if (state.status !== "checking") return state;
      const { registeredBy } = event.precheck;
      const funding =
        registeredBy === undefined ? initialFundingState : transition(initialFundingState, { type: "DUPLICATE", txHash: registeredBy });
      return { status: "checked", file: event.file, precheck: event.precheck, funding };
    }
    case "FILE_REJECTED":
      return state.status === "checking" ? { status: "unreadable", message: event.message } : state;
    case "FUNDING": {
      if (state.status !== "checked") return state;
      if (event.event.type === "PROVE" && getPaidBlocker(state.precheck) !== undefined) return state;
      const funding = transition(state.funding, event.event);
      return funding === state.funding ? state : { ...state, funding };
    }
  }
}

export type FundingStepState = "done" | "current" | "failed" | "pending";

export interface FundingStep {
  id: "proof" | "certificate" | "checks" | "loan";
  label: string;
  state: FundingStepState;
  detail?: string;
  hash?: string;
  checks?: LoanCheck[];
}

const STEP_LABELS: Record<FundingStep["id"], string> = {
  proof: "Proof computed in your browser",
  certificate: "Invoice certificate on the ledger",
  checks: "Bari's checks",
  loan: "Loan signed, money sent",
};
const STEP_IDS = Object.keys(STEP_LABELS) as FundingStep["id"][];
const MS_PER_SECOND = 1_000;

export const formatDuration = (ms: number) => `${(ms / MS_PER_SECOND).toFixed(1)} s`;

/** Où en est le financement : étapes terminées, étape en cours ou en échec (avec la raison), et ce qui est connu. */
interface Progress {
  done: number;
  active?: { state: "current" | "failed"; detail?: string };
  durationMs?: number;
  certificateTx?: string;
  checks?: LoanCheck[];
  loan?: FundingLoan;
}

function progressOf(funding: FundingState): Progress | undefined {
  switch (funding.status) {
    case "invoiceReady":
    case "duplicate":
      return undefined;
    case "proving":
      return { done: 0, active: { state: "current" } };
    case "proved":
    case "certifying":
      return { done: 1, active: { state: "current" }, durationMs: funding.durationMs };
    case "certified":
    case "underwriting":
      return { done: 2, active: { state: "current" }, durationMs: funding.durationMs, certificateTx: funding.certificate.txHash };
    case "funded":
      return {
        done: 4,
        durationMs: funding.durationMs,
        certificateTx: funding.certificate.txHash,
        checks: funding.loan.checks,
        loan: funding.loan,
      };
    case "refused":
      return {
        done: 2,
        active: { state: "failed", detail: funding.reason },
        durationMs: funding.durationMs,
        certificateTx: funding.certificate.txHash,
        checks: funding.checks,
      };
    case "error": {
      const before = progressOf(funding.retry);
      return { ...before, done: before?.done ?? 0, active: { state: "failed", detail: funding.message } };
    }
  }
}

/** Les quatre étapes de « Get paid now », chacune avec sa durée, sa transaction ou les contrôles de Bari. */
export function fundingSteps(funding: FundingState): FundingStep[] {
  const progress = progressOf(funding);
  if (progress === undefined) return [];
  const { durationMs, certificateTx, checks, loan, active } = progress;
  const known: Record<FundingStep["id"], Partial<FundingStep>> = {
    proof: durationMs === undefined ? {} : { detail: `in ${formatDuration(durationMs)}` },
    certificate: certificateTx === undefined ? {} : { hash: certificateTx },
    checks: checks === undefined ? {} : { checks },
    loan: loan === undefined ? {} : { hash: loan.txHash, detail: `${formatEur(loan.netAdvanceEur)} received` },
  };
  return STEP_IDS.map((id, index) => {
    const current = index === progress.done ? active : undefined;
    const state: FundingStepState = index < progress.done ? "done" : (current?.state ?? "pending");
    return { id, label: STEP_LABELS[id], state, ...known[id], ...(current?.detail === undefined ? {} : { detail: current.detail }) };
  });
}

export interface InvoiceRow {
  id: string;
  fingerprint: string;
  status: string;
  issuedAt: string;
  advanceEur?: number;
  feeEur?: number;
  netEur?: number;
  dueDate?: string;
  certificateTxHash?: string;
  loanTxHash?: string;
}

const STATUS_LABELS: Record<BusinessInvoice["status"], string> = {
  certified: "Certified, not financed",
  active: "Financed",
  repaid: "Repaid",
  defaulted: "Defaulted",
};
/** EURc à 6 décimales. */
const EURC_UNITS_PER_EUR = 1_000_000;

const eurOf = (units: string) => Number(units) / EURC_UNITS_PER_EUR;

/** Factures du compte, les plus récentes d'abord ; montants du prêt en euros une fois financée. */
export function invoiceRows(invoices: readonly BusinessInvoice[]): InvoiceRow[] {
  return [...invoices]
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))
    .map((invoice) => {
      const { principal, originationFee } = invoice;
      const amounts =
        principal === undefined || originationFee === undefined
          ? {}
          : {
              advanceEur: eurOf(principal),
              feeEur: eurOf(originationFee),
              netEur: Number(BigInt(principal) - BigInt(originationFee)) / EURC_UNITS_PER_EUR,
            };
      return {
        id: invoice.tokenId,
        fingerprint: invoice.nullifier,
        status: STATUS_LABELS[invoice.status],
        issuedAt: invoice.issuedAt,
        ...amounts,
        ...(invoice.dueDate === undefined ? {} : { dueDate: invoice.dueDate }),
        ...(invoice.certificateTxHash === undefined ? {} : { certificateTxHash: invoice.certificateTxHash }),
        ...(invoice.loanTxHash === undefined ? {} : { loanTxHash: invoice.loanTxHash }),
      };
    });
}
