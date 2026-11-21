// Ouverture d'un compte wallet, pure : Bari émet le credential et prépare la transaction, Otsu la signe (sans la
// soumettre), Bari la soumet ; étapes à afficher et, pour chaque erreur, la solution.

import type { OnboardingPrepareResponse, OnboardingSubmitResponse, OnboardingTx } from "../../../../src/api/contract";
import type { OtsuProvider } from "../../wallet/otsu";
import { signWithOtsu, WalletRejected } from "../../wallet/sign";
import type { VerificationStep } from "./account.machine";

export type OnboardingFailure = { kind: "rejected" } | { kind: "expired" } | { kind: "error"; message: string };

/** `done` : transactions validées, avec leur hash ; `pending` : libellés de ce qui attend la signature. */
export type OnboardingState =
  | { status: "preparing" }
  | { status: "signing"; done: OnboardingTx[]; pending: string[] }
  | { status: "submitting"; done: OnboardingTx[]; pending: string[] }
  | { status: "ready" }
  | { status: "done"; done: OnboardingTx[] }
  | { status: "failed"; failure: OnboardingFailure; done: OnboardingTx[] };

export interface OnboardingDeps {
  provider: OtsuProvider | undefined;
  prepare(): Promise<OnboardingPrepareResponse>;
  submit(txBlob: string): Promise<OnboardingSubmitResponse>;
}

/** Titre et explication de chaque état, en langage simple. */
export const ONBOARDING_COPY: Record<OnboardingState["status"], { title: string; detail: string }> = {
  preparing: { title: "Opening your account…", detail: "Atlas is checking your account and issuing your credential." },
  signing: { title: "Sign in Otsu to finish.", detail: "One signature covers every step below. Atlas sends it to the ledger." },
  submitting: { title: "Recording on the ledger…", detail: "This takes a few seconds." },
  ready: { title: "Your account is ready.", detail: "" },
  done: { title: "Your account is ready.", detail: "Every step below is a transaction on the XRP Ledger. Open one to see it." },
  failed: { title: "Your account is not ready yet.", detail: "" },
};

/** Réponse de Bari quand la transaction arrive après son échéance. */
const EXPIRED = /expired/i;

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

export async function openWalletAccount(deps: OnboardingDeps, onState: (state: OnboardingState) => void): Promise<OnboardingState> {
  let done: OnboardingTx[] = [];
  let signed = false;
  try {
    onState({ status: "preparing" });
    if (deps.provider === undefined) throw new Error("Otsu wallet is not available in this browser.");
    const prepared = await deps.prepare();
    done = prepared.transactions;
    if (prepared.status === "ready") return { status: "ready" };

    onState({ status: "signing", done, pending: prepared.labels });
    const txBlob = await signWithOtsu(deps.provider, prepared.tx);
    signed = true;
    onState({ status: "submitting", done, pending: prepared.labels });
    const submitted = await deps.submit(txBlob);
    return { status: "done", done: [...done, ...submitted.transactions] };
  } catch (cause) {
    if (cause instanceof WalletRejected) return { status: "failed", failure: { kind: "rejected" }, done };
    const message = messageOf(cause);
    if (signed && EXPIRED.test(message)) return { status: "failed", failure: { kind: "expired" }, done };
    return { status: "failed", failure: { kind: "error", message }, done };
  }
}

export function onboardingSteps(state: OnboardingState): VerificationStep[] {
  if (state.status === "preparing" || state.status === "ready") return [];
  const done = state.done.map(({ label, hash }) => ({ label, done: true, hash }));
  if (state.status !== "signing" && state.status !== "submitting") return done;
  return [...done, ...state.pending.map((label) => ({ label, done: false, hash: undefined }))];
}

export function onboardingHelp(failure: OnboardingFailure): { message: string; fix: string } {
  switch (failure.kind) {
    case "rejected":
      return { message: "The request was declined in Otsu.", fix: "Try again and approve the request in the Otsu window." };
    case "expired":
      return { message: "The request expired before it reached the ledger.", fix: "Try again: Atlas prepares a fresh one." };
    case "error":
      return { message: failure.message, fix: "Try again. If it keeps failing, connect your wallet again." };
  }
}
