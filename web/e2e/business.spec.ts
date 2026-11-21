// Espace entreprise de bout en bout sur le réseau : facture signée déposée, offre, « Get paid now », doublon refusé.

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { AttestedInvoiceFile, LoanResponse, ProofParams, SignupResponse } from "../../src/api/contract";
import { capture } from "./capture";
import { signedInvoice } from "./signedInvoice";

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const MS_PER_DAY = 86_400_000;
/** Certificat (Batch) puis LoanSet co-signé : plusieurs ledgers de 3 s, plus la preuve et les contrôles de Bari. */
const FUNDING_TIMEOUT_MS = 180_000;
const SIGNUP_TIMEOUT_MS = 120_000;

/** Entreprise inscrite par l'API dans le contexte de la page : le cookie de session suit dans la page. */
async function signUpBusiness(request: APIRequestContext, id: string): Promise<string> {
  const response = await request.post("/api/auth/signup", {
    data: {
      email: `business-${id}@e2e.example`,
      password: "correct horse battery",
      role: "business",
      profile: { company: `E2E Forniture ${id} S.r.l.`, vatNumber: `IT6${id.slice(-10)}` },
    },
    timeout: SIGNUP_TIMEOUT_MS,
  });
  expect(response.status(), await response.text()).toBe(HTTP_CREATED);
  const { user } = (await response.json()) as SignupResponse;
  expect(user.address).toBeDefined();
  return user.address ?? "";
}

/** Facture unique de 10 340 $ à 90 jours sur la Regione Puglia (jamais la Comune di Bari, réservée au pitch). */
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

async function dropInvoice(page: Page, file: AttestedInvoiceFile): Promise<void> {
  await page.getByTestId("drop-input").setInputFiles({
    name: `${file.invoice.number}.bari.json`,
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(file)),
  });
}

test("a business drops a signed invoice, gets paid now, and cannot finance it twice", async ({ page }) => {
  const id = `${Date.now()}`;
  const file = await invoiceFor(page.request, await signUpBusiness(page.request, id), id);
  let loanId: string | undefined;

  try {
    await test.step("the signed invoice is checked in the page and the offer shows", async () => {
      await page.goto("/#/business");
      await expect(page.getByRole("heading", { name: "Ask your client to confirm your invoice on Bari." })).toBeVisible();
      await dropInvoice(page, file);
      const checks = page.getByTestId("invoice-checks");
      await expect(checks.locator(".check")).toHaveCount(7);
      await expect(checks.locator(".check.fail")).toHaveCount(0);
      await expect(page.locator(".offer-row", { hasText: /^Advance/ })).toContainText("$9,000.00");
      await expect(page.locator(".offer-row", { hasText: /^Proven tier/ })).toContainText("$10,000.00");
      await expect(page.getByText("The exact amount stays private.")).toBeVisible();
      await capture(page, "business-offer");
    });

    await test.step("Get paid now: proof, certificate, Bari's checks, loan", async () => {
      const loanResponse = page.waitForResponse((response) => response.url().endsWith("/api/sme/loan"), {
        timeout: FUNDING_TIMEOUT_MS,
      });
      await page.getByRole("button", { name: "Get paid now" }).click();
      const response = await loanResponse;
      expect(response.status(), await response.text()).toBe(HTTP_CREATED);
      const loan = (await response.json()) as LoanResponse;
      loanId = loan.loanId;
      expect(loan.transactions.map((tx) => tx.result)).toEqual(loan.transactions.map(() => "tesSUCCESS"));

      await expect(page.getByTestId("business-funded")).toContainText("8,955.00 RLUSD");
      const steps = page.getByTestId("funding-steps");
      await expect(steps.locator("li.done")).toHaveCount(4);
      await expect(steps.locator('li[data-step="proof"]')).toContainText(/in \d+\.\d s/);
      await expect(steps.locator('a[href^="#/tx/"]')).toHaveCount(2);
      await expect(page.getByTestId("bari-checks").locator(".check")).toHaveCount(6);
      await expect(page.getByTestId("bari-checks").locator(".check.fail")).toHaveCount(0);
      await expect(page.getByTestId("my-invoices").locator("tbody tr").first()).toContainText("Financed");
      await expect(page.getByTestId("my-invoices")).toContainText("8,955.00 RLUSD");
      await capture(page, "business-funded");
    });

    await test.step("the certificate link shows the decoded proof", async () => {
      await page.getByTestId("funding-steps").locator('li[data-step="certificate"] a').click();
      await expect(page).toHaveURL(/#\/tx\/[0-9A-F]{64}$/);
      await expect(page.getByRole("heading", { name: "Invoice certificate" })).toBeVisible({ timeout: 30_000 });
      await expect(page.locator(".offer-row", { hasText: "Proven minimum amount" })).toContainText("$10,000.00");
      await page.goBack();
      await expect(page).toHaveURL(/#\/business$/);
    });

    await test.step("the same file again: Already financed, with the registration link", async () => {
      await dropInvoice(page, file);
      const duplicate = page.getByTestId("business-duplicate");
      await expect(duplicate.getByRole("heading", { name: "Already financed" })).toBeVisible({ timeout: 60_000 });
      await expect(duplicate.locator('a[href^="#/tx/"]')).toHaveCount(1);
      await expect(page.getByRole("button", { name: "Get paid now" })).toHaveCount(0);
      await capture(page, "business-duplicate");
    });
  } finally {
    // Remboursé à la fin : les exécutions répétées ne s'accumulent pas sous la limite de concentration par débiteur.
    if (loanId !== undefined) {
      const repaid = await page.request.post(`/api/loans/${loanId}/repay`, { timeout: FUNDING_TIMEOUT_MS });
      expect(repaid.status(), await repaid.text()).toBe(HTTP_OK);
    }
  }
});
