// Machine d'état pure de l'espace entreprise : fichier signé, pré-contrôle et offre, financement, factures du compte.

import type {
  AccountCustody,
  AttestedInvoiceFile,
  BusinessInvoice,
  CheckId,
  LoanCheck,
  PrecheckResponse,
} from "../../../../src/api/contract";
import { formatRlusd } from "../../format";
import { parseJsonOrUndefined } from "../../json";
import {
  initialFundingState,
  isFundingBusy,
  transition,
  type ActiveState,
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
    return { ok: false, message: "This is not a signed Bari invoice. Drop the signed PDF your client sent you." };
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

type StepId = "proof" | "signCertificate" | "certificate" | "checks" | "signLoan" | "loan";

export interface FundingStep {
  id: StepId;
  label: string;
  state: FundingStepState;
  detail?: string;
  hash?: string;
  checks?: LoanCheck[];
}

const STEP_LABELS: Record<StepId, string> = {
  proof: "Proof computed in your browser",
  signCertificate: "Sign the certificate in Otsu",
  certificate: "Invoice certificate on the ledger",
  checks: "Bari's checks",
  signLoan: "Sign the loan in Otsu",
  loan: "Loan signed, money sent",
};
/** Compte géré : Bari signe tout ; wallet : l'entreprise signe en plus le certificat puis le prêt dans Otsu. */
const STEPS: Record<AccountCustody, readonly StepId[]> = {
  managed: ["proof", "certificate", "checks", "loan"],
  wallet: ["proof", "signCertificate", "certificate", "checks", "signLoan", "loan"],
};
const OTSU_PROMPT = "Approve the request in the Otsu window";
const MS_PER_SECOND = 1_000;

export const formatDuration = (ms: number) => `${(ms / MS_PER_SECOND).toFixed(1)} s`;

/** Étape de chaque état en cours ; avant la signature du certificat, un wallet attend que Bari le prépare. */
function activeStep(status: ActiveState["status"], custody: AccountCustody): StepId {
  switch (status) {
    case "proving":
      return "proof";
    case "proved":
    case "certifying":
      return custody === "wallet" ? "signCertificate" : "certificate";
    case "signingCertificate":
      return "signCertificate";
    case "submittingCertificate":
      return "certificate";
    case "certified":
    case "underwriting":
      return "checks";
    case "signingLoan":
      return "signLoan";
    case "submittingLoan":
      return "loan";
  }
}

/** Ce qui est déjà connu : durée de la preuve, certificat, contrôles de Bari, prêt. */
interface Known {
  durationMs?: number;
  certificateTx?: string;
  checks?: LoanCheck[];
  loan?: FundingLoan;
}

function knownOf(funding: FundingState): Known {
  switch (funding.status) {
    case "invoiceReady":
    case "duplicate":
    case "proving":
      return {};
    case "proved":
    case "certifying":
    case "signingCertificate":
    case "submittingCertificate":
      return { durationMs: funding.durationMs };
    case "certified":
    case "underwriting":
      return { durationMs: funding.durationMs, certificateTx: funding.certificate.txHash };
    case "signingLoan":
    case "submittingLoan":
    case "refused":
      return { durationMs: funding.durationMs, certificateTx: funding.certificate.txHash, checks: funding.checks };
    case "funded":
      return { durationMs: funding.durationMs, certificateTx: funding.certificate.txHash, checks: funding.loan.checks, loan: funding.loan };
    case "error":
      return knownOf(funding.retry);
  }
}

/** Étape en cours ou en échec, avec sa consigne ou sa raison ; undefined quand tout est fait. */
function activeOf(
  funding: Exclude<FundingState, { status: "invoiceReady" | "duplicate" }>,
  custody: AccountCustody,
): { id: StepId; state: "current" | "failed"; detail?: string } | undefined {
  switch (funding.status) {
    case "funded":
      return undefined;
    case "refused":
      return { id: "checks", state: "failed", detail: funding.reason };
    case "error":
      return { id: activeStep(funding.failedAt, custody), state: "failed", detail: funding.message };
    case "signingCertificate":
    case "signingLoan":
      return { id: activeStep(funding.status, custody), state: "current", detail: OTSU_PROMPT };
    default:
      return { id: activeStep(funding.status, custody), state: "current" };
  }
}

/** Les étapes de « Get paid now », chacune avec sa durée, sa transaction ou les contrôles de Bari. */
export function fundingSteps(funding: FundingState, custody: AccountCustody): FundingStep[] {
  if (funding.status === "invoiceReady" || funding.status === "duplicate") return [];
  const { durationMs, certificateTx, checks, loan } = knownOf(funding);
  const active = activeOf(funding, custody);
  const ids = STEPS[custody];
  const activeIndex = active === undefined ? ids.length : ids.indexOf(active.id);
  const known: Partial<Record<StepId, Partial<FundingStep>>> = {
    proof: durationMs === undefined ? {} : { detail: `in ${formatDuration(durationMs)}` },
    certificate: certificateTx === undefined ? {} : { hash: certificateTx },
    checks: checks === undefined ? {} : { checks },
    loan: loan === undefined ? {} : { hash: loan.txHash, detail: `${formatRlusd(loan.netAdvanceRlusd)} received` },
  };
  return ids.map((id, index) => {
    const current = index === activeIndex ? active : undefined;
    const state: FundingStepState = index < activeIndex ? "done" : (current?.state ?? "pending");
    return { id, label: STEP_LABELS[id], state, ...known[id], ...(current?.detail === undefined ? {} : { detail: current.detail }) };
  });
}

export interface InvoiceRow {
  id: string;
  fingerprint: string;
  status: string;
  issuedAt: string;
  advanceRlusd?: number;
  feeRlusd?: number;
  netRlusd?: number;
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
/** RLUSD à 6 décimales. */
const RLUSD_UNITS = 1_000_000;

const rlusdOf = (units: string) => Number(units) / RLUSD_UNITS;

/** Factures du compte, les plus récentes d'abord ; montants du prêt en RLUSD une fois financée. */
export function invoiceRows(invoices: readonly BusinessInvoice[]): InvoiceRow[] {
  return [...invoices]
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))
    .map((invoice) => {
      const { principal, originationFee } = invoice;
      const amounts =
        principal === undefined || originationFee === undefined
          ? {}
          : {
              advanceRlusd: rlusdOf(principal),
              feeRlusd: rlusdOf(originationFee),
              netRlusd: Number(BigInt(principal) - BigInt(originationFee)) / RLUSD_UNITS,
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
