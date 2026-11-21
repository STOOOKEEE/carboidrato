// Machine d'état pure du financement PME : preuve locale, certificat on-ledger, contrôles et prêt de Bari.

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
  principalEur: number;
  feeEur: number;
  /** Ce que l'entreprise reçoit : principal − frais. */
  netAdvanceEur: number;
  /** Échéance du prêt (ISO). */
  dueDate: string;
  checks: LoanCheck[];
}

export type InvoiceReadyState = { status: "invoiceReady" };
export type ProvedState = { status: "proved"; proof: FundingProof; durationMs: number };
export type CertifiedState = { status: "certified"; durationMs: number; certificate: FundingCertificate };
/** Étapes stables d'où l'on peut relancer après un échec. */
export type RetryState = InvoiceReadyState | ProvedState | CertifiedState;

export type FundingState =
  | InvoiceReadyState
  | { status: "proving" }
  | ProvedState
  | { status: "certifying"; proof: FundingProof; durationMs: number }
  | CertifiedState
  | { status: "underwriting"; durationMs: number; certificate: FundingCertificate }
  | { status: "funded"; durationMs: number; certificate: FundingCertificate; loan: FundingLoan }
  | { status: "refused"; durationMs: number; certificate: FundingCertificate; reason: string; checks: LoanCheck[] }
  | { status: "duplicate"; txHash: string }
  | { status: "error"; message: string; retry: RetryState };

export type FundingStatus = FundingState["status"];

export type FundingEvent =
  | { type: "PROVE" }
  | { type: "PROVED"; proof: FundingProof; durationMs: number }
  | { type: "CERTIFY" }
  | { type: "CERTIFIED"; certificate: FundingCertificate }
  | { type: "UNDERWRITE" }
  | { type: "FUNDED"; loan: FundingLoan }
  | { type: "REFUSED"; reason: string; checks: LoanCheck[] }
  | { type: "DUPLICATE"; txHash: string }
  | { type: "FAILED"; message: string }
  | { type: "RETRY" }
  | { type: "RESET" };

export const initialFundingState: InvoiceReadyState = Object.freeze({ status: "invoiceReady" });

const BUSY_STATUSES: readonly FundingStatus[] = ["proving", "proved", "certifying", "certified", "underwriting"];

/** De la preuve à la réponse de Bari : la page enchaîne les étapes seule, sans autre action de l'utilisateur. */
export function isFundingBusy(state: FundingState): boolean {
  return BUSY_STATUSES.includes(state.status);
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
      if (event.type === "FAILED") return { status: "error", message: event.message, retry: initialFundingState };
      return state;
    case "proved":
      if (event.type === "CERTIFY") return { status: "certifying", proof: state.proof, durationMs: state.durationMs };
      return state;
    case "certifying":
      if (event.type === "CERTIFIED") {
        return { status: "certified", durationMs: state.durationMs, certificate: event.certificate };
      }
      if (event.type === "DUPLICATE") return { status: "duplicate", txHash: event.txHash };
      if (event.type === "FAILED") {
        const retry: ProvedState = { status: "proved", proof: state.proof, durationMs: state.durationMs };
        return { status: "error", message: event.message, retry };
      }
      return state;
    case "certified":
      if (event.type === "UNDERWRITE") {
        return { status: "underwriting", durationMs: state.durationMs, certificate: state.certificate };
      }
      return state;
    case "underwriting":
      if (event.type === "FUNDED") {
        return { status: "funded", durationMs: state.durationMs, certificate: state.certificate, loan: event.loan };
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
      if (event.type === "FAILED") {
        const retry: CertifiedState = { status: "certified", durationMs: state.durationMs, certificate: state.certificate };
        return { status: "error", message: event.message, retry };
      }
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
