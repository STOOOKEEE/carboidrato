// Effets de « Get paid now » : réponses de l'API lues en issues typées, et l'étape suivante du financement selon l'état.
// Entreprise wallet : Bari renvoie la transaction à signer, Otsu la signe, le blob signé repart vers Bari.

import type {
  CertificateRequest,
  CertificateResponse,
  LoanCheck,
  LoanRefusal,
  LoanResponse,
  LoanSignature,
  PreparedSignature,
  RegistryLookup,
} from "../../../../src/api/contract";
import { WalletRejected } from "../../wallet/sign";
import type {
  FundingCertificate,
  FundingEvent,
  FundingLoan,
  FundingProof,
  FundingState,
  WalletTx,
} from "../funding/funding.machine";

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_CONFLICT = 409;
const HTTP_UNPROCESSABLE = 422;
/** RLUSD à 6 décimales. */
const RLUSD_UNITS = 1_000_000;

/** Refus dans la fenêtre d'Otsu : ce qui s'est passé, et comment continuer. */
export const OTSU_DECLINED = "The request was declined in Otsu. Click Try again, then approve it in the Otsu window.";

export type CertificateOutcome =
  | { kind: "issued"; certificate: FundingCertificate }
  /** Entreprise wallet : le Batch du certificat, à signer dans Otsu. */
  | { kind: "sign"; tx: WalletTx }
  /** `rejectedBy` : la transaction que le ledger a refusée, à défaut de l'enregistrement d'origine. */
  | { kind: "duplicate"; rejectedBy?: string }
  | { kind: "failed"; message: string };

export type LoanOutcome =
  | { kind: "funded"; loan: FundingLoan }
  /** Entreprise wallet : le LoanSet accepté par les contrôles de Bari, à signer dans Otsu. */
  | { kind: "sign"; tx: WalletTx; checks: LoanCheck[] }
  | { kind: "refused"; reason: string; checks: LoanCheck[] }
  | { kind: "failed"; message: string };

/** Ce que « Get paid now » demande au navigateur, à Otsu et à l'API ; injecté pour tester sans réseau. */
export interface FundingServices {
  prove(): Promise<FundingProof & { durationMs: number }>;
  certify(request: CertificateRequest): Promise<CertificateOutcome>;
  /** Enregistrement de N dans le registre, pour la facture en cours. */
  registration(): Promise<RegistryLookup>;
  borrow(tokenId: string): Promise<LoanOutcome>;
  /** Blob signé dans Otsu (jamais soumis par le wallet) ; lève `WalletRejected` sur un refus. */
  sign(tx: WalletTx): Promise<string>;
  /** Le blob signé du certificat, puis celui du prêt, renvoyés à Bari qui les soumet. */
  submitCertificate(txBlob: string): Promise<CertificateOutcome>;
  submitLoan(txBlob: string): Promise<LoanOutcome>;
}

/** Champ texte d'une réponse d'erreur (`error`, `hash`) : les détails varient selon la route. */
function errorField(payload: unknown, key: "error" | "hash"): string | undefined {
  if (typeof payload !== "object" || payload === null || !(key in payload)) return undefined;
  const value: unknown = Reflect.get(payload, key);
  return typeof value === "string" ? value : undefined;
}

const errorMessage = (payload: unknown, status: number) =>
  errorField(payload, "error") ?? `Atlas is unreachable (HTTP ${status}). Try again in a moment.`;

function signatureOf(status: number, payload: unknown): PreparedSignature | undefined {
  if (status !== HTTP_OK || typeof payload !== "object" || payload === null) return undefined;
  return Reflect.get(payload, "status") === "sign" ? (payload as PreparedSignature) : undefined;
}

/** Le lien du certificat ouvre le Batch qui l'émet ; à défaut (soumission séquentielle), la première transaction. */
export function certificateOutcome(status: number, payload: unknown): CertificateOutcome {
  const signature = signatureOf(status, payload);
  if (signature !== undefined) return { kind: "sign", tx: signature.tx };
  if (status === HTTP_CONFLICT) {
    const rejectedBy = errorField(payload, "hash");
    return rejectedBy === undefined ? { kind: "duplicate" } : { kind: "duplicate", rejectedBy };
  }
  if (status !== HTTP_CREATED || payload === undefined) return { kind: "failed", message: errorMessage(payload, status) };
  const { tokenId, nullifier, transactions } = payload as CertificateResponse;
  const shown = transactions.find((tx) => tx.label.startsWith("Batch")) ?? transactions[0];
  if (shown === undefined) return { kind: "failed", message: "Atlas sent no certificate transaction. Try again in a moment." };
  return { kind: "issued", certificate: { txHash: shown.hash, tokenId, nullifier } };
}

export function loanOutcome(status: number, payload: unknown): LoanOutcome {
  const signature = signatureOf(status, payload);
  if (signature !== undefined) return { kind: "sign", tx: signature.tx, checks: (signature as LoanSignature).checks };
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

async function certificateEvent(outcome: CertificateOutcome, services: FundingServices): Promise<FundingEvent> {
  switch (outcome.kind) {
    case "issued":
      return { type: "CERTIFIED", certificate: outcome.certificate };
    case "sign":
      return { type: "SIGN_CERTIFICATE", tx: outcome.tx };
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

function loanEvent(outcome: LoanOutcome): FundingEvent {
  switch (outcome.kind) {
    case "funded":
      return { type: "FUNDED", loan: outcome.loan };
    case "sign":
      return { type: "SIGN_LOAN", tx: outcome.tx, checks: outcome.checks };
    case "refused":
      return { type: "REFUSED", reason: outcome.reason, checks: outcome.checks };
    case "failed":
      return { type: "FAILED", message: outcome.message };
  }
}

async function signInOtsu(tx: WalletTx, services: FundingServices): Promise<FundingEvent> {
  try {
    return { type: "SIGNED", txBlob: await services.sign(tx) };
  } catch (error) {
    if (error instanceof WalletRejected) return { type: "FAILED", message: OTSU_DECLINED };
    throw error;
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
      return certificateEvent(await services.certify(state.proof), services);
    case "signingCertificate":
    case "signingLoan":
      return signInOtsu(state.tx, services);
    case "submittingCertificate":
      return certificateEvent(await services.submitCertificate(state.txBlob), services);
    case "certified":
      return { type: "UNDERWRITE" };
    case "underwriting":
      return loanEvent(await services.borrow(state.certificate.tokenId));
    case "submittingLoan":
      return loanEvent(await services.submitLoan(state.txBlob));
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
