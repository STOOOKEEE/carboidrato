// Machine d'état pure du financement PME : preuve locale, certificat on-ledger, prêt de Bari.

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
  txHash: string;
  mptIssuanceId: string;
  /** Empreinte N (hex) inscrite au registre. */
  nullifier: string;
}

export interface FundingLoan {
  txHash: string;
  loanId: string;
  principalEur: number;
}

export type InvoiceReadyState = { status: "invoiceReady" };
export type ProvedState = { status: "proved"; proof: FundingProof; durationMs: number };
export type CertifiedState = { status: "certified"; proof: FundingProof; certificate: FundingCertificate };
/** Étapes stables d'où l'on peut relancer après un échec. */
export type RetryState = InvoiceReadyState | ProvedState | CertifiedState;

export type FundingState =
  | InvoiceReadyState
  | { status: "proving"; startedAt: number }
  | ProvedState
  | { status: "certifying"; proof: FundingProof; durationMs: number }
  | CertifiedState
  | { status: "underwriting"; proof: FundingProof; certificate: FundingCertificate }
  | { status: "funded"; certificate: FundingCertificate; loan: FundingLoan }
  | { status: "refused"; reason: string }
  | { status: "duplicate"; txHash: string }
  | { status: "error"; message: string; retry: RetryState };

export type FundingStatus = FundingState["status"];

export type FundingEvent =
  | { type: "PROVE"; startedAt: number }
  | { type: "PROVED"; proof: FundingProof; finishedAt: number }
  | { type: "CERTIFY" }
  | { type: "CERTIFIED"; certificate: FundingCertificate }
  | { type: "UNDERWRITE" }
  | { type: "FUNDED"; loan: FundingLoan }
  | { type: "REFUSED"; reason: string }
  | { type: "DUPLICATE"; txHash: string }
  | { type: "FAILED"; message: string }
  | { type: "RETRY" }
  | { type: "RESET" };

export const initialFundingState: InvoiceReadyState = Object.freeze({ status: "invoiceReady" });

/** Un événement sans effet dans l'état courant renvoie ce même état (même référence). */
export function transition(state: FundingState, event: FundingEvent): FundingState {
  switch (state.status) {
    case "invoiceReady":
      if (event.type === "PROVE") return { status: "proving", startedAt: event.startedAt };
      if (event.type === "DUPLICATE") return { status: "duplicate", txHash: event.txHash };
      return state;
    case "proving":
      if (event.type === "PROVED") {
        return { status: "proved", proof: event.proof, durationMs: event.finishedAt - state.startedAt };
      }
      if (event.type === "FAILED") return { status: "error", message: event.message, retry: initialFundingState };
      return state;
    case "proved":
      if (event.type === "CERTIFY") {
        return { status: "certifying", proof: state.proof, durationMs: state.durationMs };
      }
      return state;
    case "certifying":
      if (event.type === "CERTIFIED") {
        return { status: "certified", proof: state.proof, certificate: event.certificate };
      }
      if (event.type === "DUPLICATE") return { status: "duplicate", txHash: event.txHash };
      if (event.type === "FAILED") {
        const retry: ProvedState = { status: "proved", proof: state.proof, durationMs: state.durationMs };
        return { status: "error", message: event.message, retry };
      }
      return state;
    case "certified":
      if (event.type === "UNDERWRITE") {
        return { status: "underwriting", proof: state.proof, certificate: state.certificate };
      }
      return state;
    case "underwriting":
      if (event.type === "FUNDED") return { status: "funded", certificate: state.certificate, loan: event.loan };
      if (event.type === "REFUSED") return { status: "refused", reason: event.reason };
      if (event.type === "FAILED") {
        const retry: CertifiedState = { status: "certified", proof: state.proof, certificate: state.certificate };
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
