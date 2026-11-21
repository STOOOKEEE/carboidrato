// Machine d'état pure du financement PME : preuve locale, certificat on-ledger, contrôles et prêt de Bari. Une
// entreprise connectée par wallet signe elle-même le certificat puis le prêt dans Otsu, que Bari soumet ensuite.

import type { LoanCheck } from "../../../../src/api/contract";

export interface Groth16Proof {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
  protocol: string;
  curve: string;
}

export interface FundingProof {
  proof: Groth16Proof;
  publicSignals: string[];
}

export interface FundingCertificate {
  /** Transaction à ouvrir pour voir le certificat (le Batch qui l'émet). */
  txHash: string;
  /** MPT facture remis à Bari, gage du prêt. */
  tokenId: string;
  /** Empreinte N (hex) inscrite au registre. */
  nullifier: string;
}

export interface FundingLoan {
  /** Hash du LoanSet co-signé. */
  txHash: string;
  loanId: string;
  principalRlusd: number;
  feeRlusd: number;
  /** Ce que l'entreprise reçoit : principal − frais. */
  netAdvanceRlusd: number;
  /** Échéance du prêt (ISO). */
  dueDate: string;
  checks: LoanCheck[];
}

/** Transaction préparée par Bari (JSON), que le wallet signe telle quelle. */
export type WalletTx = Record<string, unknown>;

export type InvoiceReadyState = { status: "invoiceReady" };
export type ProvedState = { status: "proved"; proof: FundingProof; durationMs: number };
export type CertifiedState = { status: "certified"; durationMs: number; certificate: FundingCertificate };
/** Étapes stables d'où l'on peut relancer après un échec. */
export type RetryState = InvoiceReadyState | ProvedState | CertifiedState;

/** Étapes en cours, celles où un échec peut survenir. */
export type ActiveState =
  | { status: "proving" }
  | ProvedState
  | { status: "certifying"; proof: FundingProof; durationMs: number }
  | { status: "signingCertificate"; proof: FundingProof; durationMs: number; tx: WalletTx }
  | { status: "submittingCertificate"; proof: FundingProof; durationMs: number; txBlob: string }
  | CertifiedState
  | { status: "underwriting"; durationMs: number; certificate: FundingCertificate }
  | { status: "signingLoan"; durationMs: number; certificate: FundingCertificate; checks: LoanCheck[]; tx: WalletTx }
  | { status: "submittingLoan"; durationMs: number; certificate: FundingCertificate; checks: LoanCheck[]; txBlob: string };

export type FundingState =
  | InvoiceReadyState
  | ActiveState
  | { status: "funded"; durationMs: number; certificate: FundingCertificate; loan: FundingLoan }
  | { status: "refused"; durationMs: number; certificate: FundingCertificate; reason: string; checks: LoanCheck[] }
  | { status: "duplicate"; txHash: string }
  /** `failedAt` : l'étape qui a échoué ; `retry` : d'où « Try again » repart. */
  | { status: "error"; message: string; retry: RetryState; failedAt: ActiveState["status"] };

export type FundingStatus = FundingState["status"];

export type FundingEvent =
  | { type: "PROVE" }
  | { type: "PROVED"; proof: FundingProof; durationMs: number }
  | { type: "CERTIFY" }
  | { type: "SIGN_CERTIFICATE"; tx: WalletTx }
  | { type: "CERTIFIED"; certificate: FundingCertificate }
  | { type: "UNDERWRITE" }
  | { type: "SIGN_LOAN"; tx: WalletTx; checks: LoanCheck[] }
  | { type: "SIGNED"; txBlob: string }
  | { type: "FUNDED"; loan: FundingLoan }
  | { type: "REFUSED"; reason: string; checks: LoanCheck[] }
  | { type: "DUPLICATE"; txHash: string }
  | { type: "FAILED"; message: string }
  | { type: "RETRY" }
  | { type: "RESET" };

export const initialFundingState: InvoiceReadyState = Object.freeze({ status: "invoiceReady" });

const BUSY_STATUSES: readonly FundingStatus[] = [
  "proving",
  "proved",
  "certifying",
  "signingCertificate",
  "submittingCertificate",
  "certified",
  "underwriting",
  "signingLoan",
  "submittingLoan",
];

/** De la preuve à la réponse de Bari : la page enchaîne les étapes seule (signatures dans Otsu comprises). */
export function isFundingBusy(state: FundingState): boolean {
  return BUSY_STATUSES.includes(state.status);
}

const failed = (state: ActiveState, message: string, retry: RetryState): FundingState => ({
  status: "error",
  message,
  retry,
  failedAt: state.status,
});

/** Un échec pendant le certificat repart de la preuve ; pendant le prêt, du certificat émis. */
function certificateRetry(state: { proof: FundingProof; durationMs: number }): ProvedState {
  return { status: "proved", proof: state.proof, durationMs: state.durationMs };
}

function loanRetry(state: { durationMs: number; certificate: FundingCertificate }): CertifiedState {
  return { status: "certified", durationMs: state.durationMs, certificate: state.certificate };
}

/** Un événement sans effet dans l'état courant renvoie ce même état (même référence). */
export function transition(state: FundingState, event: FundingEvent): FundingState {
  switch (state.status) {
    case "invoiceReady":
      if (event.type === "PROVE") return { status: "proving" };
      if (event.type === "DUPLICATE") return { status: "duplicate", txHash: event.txHash };
      return state;
    case "proving":
      if (event.type === "PROVED") return { status: "proved", proof: event.proof, durationMs: event.durationMs };
      if (event.type === "FAILED") return failed(state, event.message, initialFundingState);
      return state;
    case "proved":
      if (event.type === "CERTIFY") return { status: "certifying", proof: state.proof, durationMs: state.durationMs };
      return state;
    case "certifying":
    case "submittingCertificate":
      if (event.type === "CERTIFIED") {
        return { status: "certified", durationMs: state.durationMs, certificate: event.certificate };
      }
      if (event.type === "SIGN_CERTIFICATE" && state.status === "certifying") {
        return { status: "signingCertificate", proof: state.proof, durationMs: state.durationMs, tx: event.tx };
      }
      if (event.type === "DUPLICATE") return { status: "duplicate", txHash: event.txHash };
      if (event.type === "FAILED") return failed(state, event.message, certificateRetry(state));
      return state;
    case "signingCertificate":
      if (event.type === "SIGNED") {
        return { status: "submittingCertificate", proof: state.proof, durationMs: state.durationMs, txBlob: event.txBlob };
      }
      if (event.type === "FAILED") return failed(state, event.message, certificateRetry(state));
      return state;
    case "certified":
      if (event.type === "UNDERWRITE") {
        return { status: "underwriting", durationMs: state.durationMs, certificate: state.certificate };
      }
      return state;
    case "underwriting":
    case "submittingLoan":
      if (event.type === "FUNDED") {
        return { status: "funded", durationMs: state.durationMs, certificate: state.certificate, loan: event.loan };
      }
      if (event.type === "SIGN_LOAN" && state.status === "underwriting") {
        const { durationMs, certificate } = state;
        return { status: "signingLoan", durationMs, certificate, checks: event.checks, tx: event.tx };
      }
      if (event.type === "REFUSED") {
        return {
          status: "refused",
          durationMs: state.durationMs,
          certificate: state.certificate,
          reason: event.reason,
          checks: event.checks,
        };
      }
      if (event.type === "FAILED") return failed(state, event.message, loanRetry(state));
      return state;
    case "signingLoan":
      if (event.type === "SIGNED") {
        const { durationMs, certificate, checks } = state;
        return { status: "submittingLoan", durationMs, certificate, checks, txBlob: event.txBlob };
      }
      if (event.type === "FAILED") return failed(state, event.message, loanRetry(state));
      return state;
    case "error":
      if (event.type === "RETRY") return state.retry;
      if (event.type === "RESET") return initialFundingState;
      return state;
    case "funded":
    case "refused":
    case "duplicate":
      if (event.type === "RESET") return initialFundingState;
      return state;
  }
}
