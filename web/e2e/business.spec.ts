// Espace entreprise de bout en bout sur le réseau : facture signée déposée, offre, « Get paid now », doublon refusé ;
// pour un compte email (Bari signe) et pour un wallet Otsu (faux Otsu qui signe dans Node, Bari soumet).

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type {
  AttestedInvoiceFile,
  LoanResponse,
  PreparedSignature,
  ProofParams,
  SignupResponse,
} from "../../src/api/contract";
import { capture } from "./capture";
import { installOtsuMock, type OtsuMock } from "./fixtures/otsuMock";
import { signedInvoice } from "./signedInvoice";

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const MS_PER_DAY = 86_400_000;
/** Certificat (Batch) puis LoanSet co-signé : plusieurs ledgers de 3 s, plus la preuve et les contrôles de Bari. */
const FUNDING_TIMEOUT_MS = 180_000;
const SIGNUP_TIMEOUT_MS = 120_000;
/** Activation du wallet, credential de Bari puis Batch d'ouverture signé dans Otsu. */
const ONBOARDING_TIMEOUT_MS = 120_000;

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

/** Ce que le faux Otsu expose à la page (`window.xrpl`), le seul appel dont le test a besoin. */
type OtsuWindow = { xrpl: { signTransaction(tx: Record<string, unknown>): Promise<{ tx_blob: string }> } };

/** Entreprise ouverte par son wallet depuis l'espace entreprise : KYB_PME accepté et ligne RLUSD signés dans Otsu. */
async function openWalletBusiness(page: Page, id: string): Promise<void> {
  await page.goto("/#/business");
  await page.getByRole("button", { name: "Connect Otsu wallet" }).click();
  await expect(page.getByTestId("wallet-registration")).toBeVisible({ timeout: ONBOARDING_TIMEOUT_MS });
  await page.getByLabel("Company name").fill(`E2E Wallet Forniture ${id} S.r.l.`);
  await page.getByLabel("VAT number").fill(`IT7${id.slice(-10)}`);
  await page.getByRole("button", { name: "Create my account" }).click();
  const onboarding = page.getByTestId("wallet-onboarding");
  await expect(onboarding.getByRole("heading", { name: "Your account is ready." })).toBeVisible({ timeout: ONBOARDING_TIMEOUT_MS });
  await onboarding.getByRole("button", { name: "Open my space" }).click();
  await expect(page).toHaveURL(/#\/business$/);
}

/** Remboursement d'un wallet : la mairie paie l'entreprise, puis le LoanPay préparé par Bari est signé dans Otsu. */
async function repayWithOtsu(page: Page, loanId: string): Promise<void> {
  const prepared = await page.request.post(`/api/loans/${loanId}/repay`, { timeout: FUNDING_TIMEOUT_MS });
  expect(prepared.status(), await prepared.text()).toBe(HTTP_OK);
  const { tx } = (await prepared.json()) as PreparedSignature;
  const txBlob = await page.evaluate(
    async (loanPay) => (await (window as unknown as OtsuWindow).xrpl.signTransaction(loanPay)).tx_blob,
    tx,
  );
  const repaid = await page.request.post(`/api/loans/${loanId}/repay/submit`, {
    data: { tx_blob: txBlob },
    timeout: FUNDING_TIMEOUT_MS,
  });
  expect(repaid.status(), await repaid.text()).toBe(HTTP_OK);
}

test("a wallet business signs its certificate and its loan in Otsu, gets paid in RLUSD, and cannot finance twice", async ({
  page,
}) => {
  const id = `${Date.now()}`;
  const otsu: OtsuMock = await installOtsuMock(page);
  let loanId: string | undefined;

  try {
    await test.step("the business opens its account with its Otsu wallet", () => openWalletBusiness(page, id));
    const file = await invoiceFor(page.request, otsu.wallet.address, id);

    await test.step("the signed invoice is checked in the page", async () => {
      await dropInvoice(page, file);
      const checks = page.getByTestId("invoice-checks");
      await expect(checks.locator(".check")).toHaveCount(7);
      await expect(checks.locator(".check.fail")).toHaveCount(0);
      await expect(page.locator(".offer-row", { hasText: /^Advance/ })).toContainText("$9,000.00");
    });

    await test.step("Get paid now: certificate and loan signed in Otsu, advance received in RLUSD", async () => {
      const loanResponse = page.waitForResponse((response) => response.url().endsWith("/api/sme/loan/submit"), {
        timeout: FUNDING_TIMEOUT_MS,
      });
      await page.getByRole("button", { name: "Get paid now" }).click();
      const response = await loanResponse;
      expect(response.status(), await response.text()).toBe(HTTP_CREATED);
      const loan = (await response.json()) as LoanResponse;
      loanId = loan.loanId;
      expect(loan.netAdvance).toBe("8955000000");
      expect(loan.transactions.map((tx) => tx.result)).toEqual(loan.transactions.map(() => "tesSUCCESS"));
      const loanSet = await otsu.client.request({ command: "tx", transaction: loan.txHash });
      expect(loanSet.result.validated).toBe(true);
      expect(typeof loanSet.result.meta === "object" ? loanSet.result.meta.TransactionResult : loanSet.result.meta).toBe("tesSUCCESS");

      await expect(page.getByTestId("business-funded")).toContainText("8,955.00 RLUSD");
      const steps = page.getByTestId("funding-steps");
      await expect(steps.locator("li.done")).toHaveCount(6);
      await expect(steps.locator('li[data-step="signCertificate"]')).toContainText("Sign the certificate in Otsu");
      await expect(steps.locator('li[data-step="signLoan"]')).toContainText("Sign the loan in Otsu");
      await expect(steps.locator('a[href^="#/tx/"]')).toHaveCount(2);
      await expect(page.getByTestId("bari-checks").locator(".check")).toHaveCount(6);
      await expect(page.getByTestId("bari-checks").locator(".check.fail")).toHaveCount(0);
      await expect(page.getByTestId("my-invoices").locator("tbody tr").first()).toContainText("Financed");
      await capture(page, "business-wallet-funded");
    });

    await test.step("the same file again: Already financed", async () => {
      await dropInvoice(page, file);
      const duplicate = page.getByTestId("business-duplicate");
      await expect(duplicate.getByRole("heading", { name: "Already financed" })).toBeVisible({ timeout: 60_000 });
      await expect(page.getByRole("button", { name: "Get paid now" })).toHaveCount(0);
    });
  } finally {
    // Remboursé à la fin, signé dans Otsu : un prêt impayé entamerait la first-loss du fonds.
    if (loanId !== undefined) await repayWithOtsu(page, loanId);
    await otsu.close();
  }
});
