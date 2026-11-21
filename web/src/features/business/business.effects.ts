// Effets de « Get paid now » : réponses de l'API lues en issues typées, et l'étape suivante du financement selon l'état.

import type {
  CertificateRequest,
  CertificateResponse,
  LoanCheck,
  LoanRefusal,
  LoanResponse,
  RegistryLookup,
} from "../../../../src/api/contract";
import type { FundingCertificate, FundingEvent, FundingLoan, FundingProof, FundingState } from "../funding/funding.machine";

const HTTP_CREATED = 201;
const HTTP_CONFLICT = 409;
const HTTP_UNPROCESSABLE = 422;
/** RLUSD à 6 décimales. */
const RLUSD_UNITS = 1_000_000;

export type CertificateOutcome =
  | { kind: "issued"; certificate: FundingCertificate }
  /** `rejectedBy` : la transaction que le ledger a refusée, à défaut de l'enregistrement d'origine. */
  | { kind: "duplicate"; rejectedBy?: string }
  | { kind: "failed"; message: string };

export type LoanOutcome =
  | { kind: "funded"; loan: FundingLoan }
  | { kind: "refused"; reason: string; checks: LoanCheck[] }
  | { kind: "failed"; message: string };

/** Ce que « Get paid now » demande au navigateur et à l'API ; injecté pour tester sans réseau. */
export interface FundingServices {
  prove(): Promise<FundingProof & { durationMs: number }>;
  certify(request: CertificateRequest): Promise<CertificateOutcome>;
  /** Enregistrement de N dans le registre, pour la facture en cours. */
  registration(): Promise<RegistryLookup>;
  borrow(tokenId: string): Promise<LoanOutcome>;
}

/** Champ texte d'une réponse d'erreur (`error`, `hash`) : les détails varient selon la route. */
function errorField(payload: unknown, key: "error" | "hash"): string | undefined {
  if (typeof payload !== "object" || payload === null || !(key in payload)) return undefined;
  const value: unknown = Reflect.get(payload, key);
  return typeof value === "string" ? value : undefined;
}

const errorMessage = (payload: unknown, status: number) =>
  errorField(payload, "error") ?? `Bari is unreachable (HTTP ${status}). Try again in a moment.`;

/** Le lien du certificat ouvre le Batch qui l'émet ; à défaut (soumission séquentielle), la première transaction. */
export function certificateOutcome(status: number, payload: unknown): CertificateOutcome {
  if (status === HTTP_CONFLICT) {
    const rejectedBy = errorField(payload, "hash");
    return rejectedBy === undefined ? { kind: "duplicate" } : { kind: "duplicate", rejectedBy };
  }
  if (status !== HTTP_CREATED || payload === undefined) return { kind: "failed", message: errorMessage(payload, status) };
  const { tokenId, nullifier, transactions } = payload as CertificateResponse;
  const shown = transactions.find((tx) => tx.label.startsWith("Batch")) ?? transactions[0];
  if (shown === undefined) return { kind: "failed", message: "Bari sent no certificate transaction. Try again in a moment." };
  return { kind: "issued", certificate: { txHash: shown.hash, tokenId, nullifier } };
}

export function loanOutcome(status: number, payload: unknown): LoanOutcome {
  if (status === HTTP_UNPROCESSABLE && typeof payload === "object" && payload !== null && "checks" in payload) {
    const refusal = payload as LoanRefusal;
    return { kind: "refused", reason: refusal.error, checks: refusal.checks };
  }
  if (status !== HTTP_CREATED || payload === undefined) return { kind: "failed", message: errorMessage(payload, status) };
  const loan = payload as LoanResponse;
  return {
    kind: "funded",
    loan: {
      txHash: loan.txHash,
      loanId: loan.loanId,
      principalRlusd: Number(loan.principal) / RLUSD_UNITS,
      feeRlusd: Number(loan.originationFee) / RLUSD_UNITS,
      netAdvanceRlusd: Number(loan.netAdvance) / RLUSD_UNITS,
      dueDate: loan.dueDate,
      checks: loan.checks,
    },
  };
}

async function certify(proof: FundingProof, services: FundingServices): Promise<FundingEvent> {
  const outcome = await services.certify(proof);
  switch (outcome.kind) {
    case "issued":
      return { type: "CERTIFIED", certificate: outcome.certificate };
    case "failed":
      return { type: "FAILED", message: outcome.message };
    case "duplicate": {
      // Le lien « Already financed » montre l'enregistrement d'origine de N, pas le Batch qui vient d'échouer.
      const registration = await services.registration().catch((): RegistryLookup => ({ registered: false }));
      const txHash = registration.txHash ?? outcome.rejectedBy;
      return txHash === undefined
        ? { type: "FAILED", message: "The ledger already holds this invoice: it cannot be financed twice." }
        : { type: "DUPLICATE", txHash };
    }
  }
}

async function borrow(tokenId: string, services: FundingServices): Promise<FundingEvent> {
  const outcome = await services.borrow(tokenId);
  switch (outcome.kind) {
    case "funded":
      return { type: "FUNDED", loan: outcome.loan };
    case "refused":
      return { type: "REFUSED", reason: outcome.reason, checks: outcome.checks };
    case "failed":
      return { type: "FAILED", message: outcome.message };
  }
}

async function effectOf(state: FundingState, services: FundingServices): Promise<FundingEvent | undefined> {
  switch (state.status) {
    case "proving": {
      const { proof, publicSignals, durationMs } = await services.prove();
      return { type: "PROVED", proof: { proof, publicSignals }, durationMs };
    }
    case "proved":
      return { type: "CERTIFY" };
    case "certifying":
      return certify(state.proof, services);
    case "certified":
      return { type: "UNDERWRITE" };
    case "underwriting":
      return borrow(state.certificate.tokenId, services);
    default:
      return undefined;
  }
}

/** Événement qui fait avancer le financement depuis cet état ; undefined dans un état stable. */
export async function nextFundingEvent(state: FundingState, services: FundingServices): Promise<FundingEvent | undefined> {
  try {
    return await effectOf(state, services);
  } catch (error) {
    return { type: "FAILED", message: error instanceof Error ? error.message : String(error) };
  }
}
