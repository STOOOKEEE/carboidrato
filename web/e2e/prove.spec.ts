// Preuve et pré-contrôle dans l'espace entreprise : la facture signée ne quitte jamais la page, seule la preuve part.

import { expect, test, type APIRequestContext, type Request } from "@playwright/test";
import type { AttestedInvoiceFile, CertificateRequest, ProofParams, SignupResponse } from "../../src/api/contract";
import { signedInvoice } from "./signedInvoice";

const WITNESS_KEYS = ["amount", "amountCents", "uuid", "signature", "pathElements", "pathIndices", "blinding"];
const HTTP_CREATED = 201;
const MS_PER_DAY = 86_400_000;
const FUNDING_TIMEOUT_MS = 180_000;
const SIGNUP_TIMEOUT_MS = 120_000;

/** Entreprise inscrite par l'API dans le contexte de la page : le cookie de session suit dans la page. */
async function signUpBusiness(request: APIRequestContext, id: string): Promise<string> {
  const response = await request.post("/api/auth/signup", {
    data: {
      email: `prover-${id}@e2e.example`,
      password: "correct horse battery",
      role: "business",
      profile: { company: `E2E Prove ${id} S.r.l.`, vatNumber: `IT8${id.slice(-10)}` },
    },
    timeout: SIGNUP_TIMEOUT_MS,
  });
  expect(response.status(), await response.text()).toBe(HTTP_CREATED);
  const { user } = (await response.json()) as SignupResponse;
  return user.address ?? "";
}

/** Facture unique sur la Regione Puglia (jamais la Comune di Bari, réservée au pitch). */
async function invoiceFor(request: APIRequestContext, account: string, id: string): Promise<AttestedInvoiceFile> {
  const params = (await (await request.get("/api/proof/params")).json()) as ProofParams;
  return signedInvoice(
    {
      number: `E2E-${id}`,
      debtorName: "Regione Puglia",
      supplierAccount: account,
      amountUsd: 10_340,
      dueDate: new Date(Date.now() + 90 * MS_PER_DAY),
    },
    params,
  );
}

function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...keysOf(child)]);
}

function jsonBody(sent: Request): unknown {
  try {
    return sent.postDataJSON();
  } catch {
    return undefined;
  }
}

test("the business page computes the proof and sends only { proof, publicSignals }", async ({ page }) => {
  const id = `${Date.now()}`;
  const file = await invoiceFor(page.request, await signUpBusiness(page.request, id), id);
  const { attestation } = file;
  const secrets = [attestation.uuid, attestation.signature.s, attestation.signature.r8x, attestation.amountCents];
  const requests: Request[] = [];
  page.on("request", (sent) => requests.push(sent));
  // Ce test s'arrête au certificat : la demande de prêt est coupée, aucun prêt ne s'ajoute à l'exposition du débiteur.
  await page.route("**/api/sme/loan", (route) => route.abort());

  await page.goto("/#/business");
  await page.getByTestId("drop-input").setInputFiles({
    name: `${file.invoice.number}.bari.json`,
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(file)),
  });
  await expect(page.locator(".offer-row", { hasText: /^Proven tier/ })).toContainText("$10,000.00");

  const certificateRequest = page.waitForRequest(
    (sent) => sent.method() === "POST" && sent.url().endsWith("/api/sme/certificate"),
    { timeout: FUNDING_TIMEOUT_MS },
  );
  await page.getByRole("button", { name: "Get paid now" }).click();

  const sent = await certificateRequest;
  const body = sent.postDataJSON() as CertificateRequest;
  expect(Object.keys(body).sort()).toEqual(["proof", "publicSignals"]);
  expect(body.publicSignals).not.toContain(attestation.amountCents);
  const steps = page.getByTestId("funding-steps");
  await expect(steps.locator('li[data-step="proof"]')).toContainText(/in \d+\.\d s/);
  expect((await sent.response())?.status()).toBe(HTTP_CREATED);

  // Le certificat est émis ; la demande de prêt coupée échoue avec une consigne, et l'action reste disponible.
  await expect(steps.locator('li[data-step="certificate"].done a[href^="#/tx/"]')).toHaveCount(1, { timeout: FUNDING_TIMEOUT_MS });
  await expect(steps.locator('li[data-step="checks"].failed')).toContainText("Atlas did not answer.");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();

  // Pré-contrôle et preuve : aucune requête de la page ne porte le témoin ni la facture.
  expect(requests.some((request) => request.url().includes("/api/check"))).toBe(false);
  for (const request of requests) {
    const payload = `${request.url()} ${request.postData() ?? ""}`;
    for (const secret of secrets) expect(payload, request.url()).not.toContain(secret);
    const sentKeys = keysOf(jsonBody(request));
    for (const key of WITNESS_KEYS) expect(sentKeys, request.url()).not.toContain(key);
  }
});
