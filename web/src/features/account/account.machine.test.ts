// Tests des formulaires de compte : validation du KYC léger par rôle, transitions et écran « Verifying… ».

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { SubmittedTx } from "../../../../src/api/contract";
import {
  EMPTY_DRAFT,
  formTransition,
  initialFormState,
  validateSignin,
  validateSignup,
  verificationSteps,
  type FormEvent,
  type FormState,
  type SignupDraft,
} from "./account.machine";

const credentials = { email: " ada@example.com ", password: "correct horse" };
const lenderDraft: SignupDraft = { ...EMPTY_DRAFT, ...credentials, name: " Ada Lovelace ", country: "IT", riskAcknowledged: true };
const businessDraft: SignupDraft = { ...EMPTY_DRAFT, ...credentials, company: "Acme Srl", vatNumber: "IT 01234567890" };

describe("validateSignup", () => {
  test("prêteur : requête au format de l'API, champs nettoyés, consentement au risque", () => {
    assert.deepEqual(validateSignup("lender", lenderDraft), {
      ok: true,
      request: {
        email: "ada@example.com",
        password: "correct horse",
        role: "lender",
        profile: { name: "Ada Lovelace", country: "IT", riskAcknowledged: true },
      },
    });
  });

  test("prêteur : consentement, nom et pays obligatoires", () => {
    const result = validateSignup("lender", { ...lenderDraft, name: " ", country: "", riskAcknowledged: false });
    assert.equal(result.ok, false);
    assert.deepEqual(Object.keys(result.ok ? {} : result.errors).sort(), ["country", "name", "riskAcknowledged"]);
  });

  test("email invalide et mot de passe de moins de 8 caractères refusés", () => {
    const result = validateSignup("lender", { ...lenderDraft, email: "ada@", password: "short" });
    assert.equal(result.ok, false);
    assert.deepEqual(Object.keys(result.ok ? {} : result.errors).sort(), ["email", "password"]);
  });

  test("entreprise : raison sociale et n° de TVA à préfixe pays", () => {
    assert.deepEqual(validateSignup("business", businessDraft), {
      ok: true,
      request: {
        email: "ada@example.com",
        password: "correct horse",
        role: "business",
        profile: { company: "Acme Srl", vatNumber: "IT 01234567890" },
      },
    });
    const invalid = validateSignup("business", { ...businessDraft, company: "", vatNumber: "0123" });
    assert.deepEqual(Object.keys(invalid.ok ? {} : invalid.errors).sort(), ["company", "vatNumber"]);
  });

  test("organisme public : choisi dans le registre", () => {
    const missing = validateSignup("public_body", { ...EMPTY_DRAFT, ...credentials });
    assert.deepEqual(Object.keys(missing.ok ? {} : missing.errors), ["ipaCode"]);
    assert.deepEqual(validateSignup("public_body", { ...EMPTY_DRAFT, ...credentials, ipaCode: "c_a662" }), {
      ok: true,
      request: { email: "ada@example.com", password: "correct horse", role: "public_body", profile: { ipaCode: "c_a662" } },
    });
  });
});

describe("validateSignin", () => {
  test("email et mot de passe requis", () => {
    const result = validateSignin({ email: "", password: "" });
    assert.deepEqual(Object.keys(result.ok ? {} : result.errors).sort(), ["email", "password"]);
    assert.deepEqual(validateSignin(credentials), {
      ok: true,
      request: { email: "ada@example.com", password: "correct horse" },
    });
  });
});

describe("formTransition", () => {
  const valid: FormEvent = { type: "SUBMIT", validation: { ok: true } };
  const invalid: FormEvent = { type: "SUBMIT", validation: { ok: false, errors: { email: "Enter a valid email" } } };
  const transactions: SubmittedTx[] = [{ label: "Payment genesis → lender", hash: "AA", result: "tesSUCCESS" }];

  test("formulaire invalide : les erreurs s'affichent, rien n'est envoyé", () => {
    assert.deepEqual(formTransition(initialFormState, invalid), { status: "editing", errors: { email: "Enter a valid email" } });
  });

  test("envoi, puis succès avec les transactions ou échec avec le message", () => {
    const submitting = formTransition(initialFormState, valid);
    assert.deepEqual(submitting, { status: "submitting" });
    assert.deepEqual(formTransition(submitting, { type: "SUCCEEDED", transactions }), { status: "done", transactions });
    const failed = formTransition(submitting, { type: "FAILED", message: "Email already registered" });
    assert.deepEqual(failed, { status: "failed", message: "Email already registered" });
    assert.deepEqual(formTransition(failed, valid), { status: "submitting" });
  });

  test("modifier un champ efface son erreur, et le message d'échec", () => {
    const editing: FormState = { status: "editing", errors: { email: "x", password: "y" } };
    assert.deepEqual(formTransition(editing, { type: "EDIT", field: "email" }), { status: "editing", errors: { password: "y" } });
    assert.deepEqual(formTransition({ status: "failed", message: "m" }, { type: "EDIT", field: "email" }), {
      status: "editing",
      errors: {},
    });
  });

  test("un événement invalide ne change pas l'état", () => {
    const submitting: FormState = { status: "submitting" };
    const done: FormState = { status: "done", transactions };
    for (const [state, event] of [
      [initialFormState, { type: "SUCCEEDED", transactions }],
      [initialFormState, { type: "FAILED", message: "m" }],
      [submitting, valid],
      [submitting, { type: "EDIT", field: "email" }],
      [done, valid],
      [done, { type: "FAILED", message: "m" }],
    ] as [FormState, FormEvent][]) {
      assert.equal(formTransition(state, event), state);
    }
  });
});

describe("verificationSteps", () => {
  test("en attente de l'API : les étapes attendues du rôle, sans hash", () => {
    const steps = verificationSteps("business", undefined);
    assert.deepEqual(
      steps.map((step) => step.label),
      ["XRPL account opened", "KYB_PME credential issued by Bari", "Credential accepted by your account", "Euro token (EURc) enabled"],
    );
    assert.ok(steps.every((step) => !step.done && step.hash === undefined));
  });

  test("après l'inscription : chaque étape reçoit le hash de sa transaction", () => {
    const tx = (label: string, hash: string): SubmittedTx => ({ label, hash, result: "tesSUCCESS" });
    const steps = verificationSteps("lender", [
      tx("Payment genesis → lender", "P"),
      tx("CredentialCreate KYC_INVESTOR → lender", "C"),
      tx("CredentialAccept KYC_INVESTOR (lender)", "A"),
      tx("MPTokenAuthorize EURc (lender)", "E"),
      tx("MPTokenAuthorize Vault shares (lender)", "S"),
    ]);
    assert.deepEqual(
      steps.map(({ label, done, hash }) => [label, done, hash]),
      [
        ["XRPL account opened", true, "P"],
        ["KYC_INVESTOR credential issued by Bari", true, "C"],
        ["Credential accepted by your account", true, "A"],
        ["Euro token (EURc) enabled", true, "E"],
        ["Fund shares enabled", true, "S"],
      ],
    );
  });

  test("compte financé par un faucet (sans transaction de Bari) : étape faite, sans lien", () => {
    const [opened] = verificationSteps("business", [{ label: "CredentialCreate KYB_PME → business", hash: "C", result: "tesSUCCESS" }]);
    assert.deepEqual(opened, { label: "XRPL account opened", done: true, hash: undefined });
  });

  test("organisme public : aucune transaction", () => {
    assert.deepEqual(verificationSteps("public_body", []), []);
  });
});
