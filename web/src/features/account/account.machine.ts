// Formulaires d'inscription et de connexion, purs : KYC léger par rôle, envoi, et étapes de l'écran « Verifying… ».

import type { SigninRequest, SignupRequest, SubmittedTx, UserRole } from "../../../../src/api/contract";

export interface SignupDraft {
  email: string;
  password: string;
  name: string;
  country: string;
  riskAcknowledged: boolean;
  company: string;
  vatNumber: string;
  ipaCode: string;
}

export type DraftField = keyof SignupDraft;
export type FieldErrors = Partial<Record<DraftField, string>>;
export type Validation<T> = { ok: true; request: T } | { ok: false; errors: FieldErrors };

export const EMPTY_DRAFT: SignupDraft = {
  email: "",
  password: "",
  name: "",
  country: "",
  riskAcknowledged: false,
  company: "",
  vatNumber: "",
  ipaCode: "",
};

// Mêmes règles que les schémas de l'API (`src/api/fund/schemas.ts`).
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const COUNTRY_PATTERN = /^[A-Z]{2}$/;
const VAT_PATTERN = /^[A-Za-z]{2}[0-9A-Za-z ]{2,20}$/;

function credentialErrors(email: string, password: string): FieldErrors {
  return {
    ...(EMAIL_PATTERN.test(email) ? {} : { email: "Enter a valid email address" }),
    ...(password.length >= MIN_PASSWORD_LENGTH ? {} : { password: `Use at least ${MIN_PASSWORD_LENGTH} characters` }),
  };
}

const outcome = <T>(errors: FieldErrors, request: T): Validation<T> =>
  Object.keys(errors).length === 0 ? { ok: true, request } : { ok: false, errors };

export function validateSignup(role: UserRole, draft: SignupDraft): Validation<SignupRequest> {
  const email = draft.email.trim();
  const { password } = draft;
  const base = credentialErrors(email, password);
  switch (role) {
    case "lender": {
      const name = draft.name.trim();
      const errors: FieldErrors = {
        ...base,
        ...(name === "" ? { name: "Enter your full name" } : {}),
        ...(COUNTRY_PATTERN.test(draft.country) ? {} : { country: "Choose your country of residence" }),
        ...(draft.riskAcknowledged ? {} : { riskAcknowledged: "Tick this box to lend through Bari" }),
      };
      return outcome(errors, {
        email,
        password,
        role,
        profile: { name, country: draft.country, riskAcknowledged: true as const },
      });
    }
    case "business": {
      const company = draft.company.trim();
      const vatNumber = draft.vatNumber.trim();
      const errors: FieldErrors = {
        ...base,
        ...(company === "" ? { company: "Enter your company name" } : {}),
        ...(VAT_PATTERN.test(vatNumber) ? {} : { vatNumber: "Enter a VAT number with its country code, e.g. IT01234567890" }),
      };
      return outcome(errors, { email, password, role, profile: { company, vatNumber } });
    }
    case "public_body": {
      const errors: FieldErrors = { ...base, ...(draft.ipaCode === "" ? { ipaCode: "Choose your public body" } : {}) };
      return outcome(errors, { email, password, role, profile: { ipaCode: draft.ipaCode } });
    }
  }
}

export function validateSignin(draft: { email: string; password: string }): Validation<SigninRequest> {
  const email = draft.email.trim();
  const errors: FieldErrors = {
    ...(email === "" ? { email: "Enter your email address" } : {}),
    ...(draft.password === "" ? { password: "Enter your password" } : {}),
  };
  return outcome(errors, { email, password: draft.password });
}

export type FormState =
  | { status: "editing"; errors: FieldErrors }
  | { status: "submitting" }
  | { status: "failed"; message: string }
  | { status: "done"; transactions: SubmittedTx[] };

export type FormEvent =
  | { type: "SUBMIT"; validation: { ok: true } | { ok: false; errors: FieldErrors } }
  | { type: "SUCCEEDED"; transactions: SubmittedTx[] }
  | { type: "FAILED"; message: string }
  | { type: "EDIT"; field: DraftField };

export const initialFormState: FormState = { status: "editing", errors: {} };

export function formTransition(state: FormState, event: FormEvent): FormState {
  switch (event.type) {
    case "SUBMIT":
      if (state.status !== "editing" && state.status !== "failed") return state;
      return event.validation.ok ? { status: "submitting" } : { status: "editing", errors: event.validation.errors };
    case "SUCCEEDED":
      return state.status === "submitting" ? { status: "done", transactions: event.transactions } : state;
    case "FAILED":
      return state.status === "submitting" ? { status: "failed", message: event.message } : state;
    case "EDIT": {
      if (state.status === "failed") return initialFormState;
      if (state.status !== "editing") return state;
      const { [event.field]: _cleared, ...errors } = state.errors;
      return { status: "editing", errors };
    }
  }
}

export interface VerificationStep {
  label: string;
  done: boolean;
  hash: string | undefined;
}

/** Étapes d'ouverture d'un compte géré, reconnues au type de transaction en tête du libellé renvoyé par l'API. */
const STEPS: Record<UserRole, { label: string; matches: (txLabel: string) => boolean }[]> = {
  lender: [
    { label: "XRPL account opened", matches: (tx) => tx.startsWith("Payment") },
    { label: "KYC_INVESTOR credential issued by Bari", matches: (tx) => tx.startsWith("CredentialCreate") },
    { label: "Credential accepted by your account", matches: (tx) => tx.startsWith("CredentialAccept") },
    { label: "Dollar stablecoin (RLUSD) enabled", matches: (tx) => tx.startsWith("TrustSet RLUSD") },
    { label: "Fund shares enabled", matches: (tx) => tx.startsWith("MPTokenAuthorize Vault shares") },
  ],
  business: [
    { label: "XRPL account opened", matches: (tx) => tx.startsWith("Payment") },
    { label: "KYB_PME credential issued by Bari", matches: (tx) => tx.startsWith("CredentialCreate") },
    { label: "Credential accepted by your account", matches: (tx) => tx.startsWith("CredentialAccept") },
    { label: "Dollar stablecoin (RLUSD) enabled", matches: (tx) => tx.startsWith("TrustSet RLUSD") },
  ],
  public_body: [],
};

export function verificationSteps(role: UserRole, transactions: SubmittedTx[] | undefined): VerificationStep[] {
  return STEPS[role].map(({ label, matches }) => ({
    label,
    done: transactions !== undefined,
    hash: transactions?.find((tx) => matches(tx.label))?.hash,
  }));
}
