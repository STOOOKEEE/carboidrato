// Parcours complet du pitch dans le vrai produit (SPEC § Parcours de démo), un test.step par étape, trois acteurs séparés :
// le prêteur et l'entreprise connectés par Otsu (faux Otsu qui signe dans Node), l'organisme public par email.

import { readFile } from "node:fs/promises";
import { expect, test, type Browser, type Page } from "@playwright/test";
import type { LoanResponse } from "../../src/api/contract";
import { fatturaPaXml, PITCH_SUPPLIER, REGIONE_PUGLIA } from "../../src/demo/sampleInvoices";
import { capture } from "./capture";
import { ledgerShares, repayWithOtsu, succeededHashes } from "./fixtures/otsuLedger";
import { installOtsuMock, type OtsuMock } from "./fixtures/otsuMock";
import { signInPublicBody } from "./publicBodySession";

const HTTP_CREATED = 201;
const MS_PER_DAY = 86_400_000;
const TERM_DAYS = 90;
const TOTAL_CENTS = 1_034_000n;
/** Activation du wallet, credential de Bari puis Batch d'ouverture signé dans Otsu. */
const ONBOARDING_TIMEOUT_MS = 120_000;
const TX_TIMEOUT_MS = 90_000;
/** Certificat (Batch) puis LoanSet signé dans Otsu et co-signé par Bari, plus la preuve et les contrôles de Bari. */
const FUNDING_TIMEOUT_MS = 180_000;
const AUDIT_TIMEOUT_MS = 120_000;
const TX_LINK = 'a[href^="#/tx/"]';
const SUMMARY = /(\d+)\/(\d+) proofs verified in your browser/;

/** Chiffres uniques sans « 1034 » : la recherche par TVA ne doit pas faire apparaître le montant. */
function uniqueDigits(length: number): string {
  for (;;) {
    const digits = `${Date.now()}${Math.floor(Math.random() * 1e6)}`.slice(-length);
    if (!digits.includes("1034")) return digits;
  }
}

async function actor(browser: Browser): Promise<Page> {
  return (await browser.newContext()).newPage();
}

/** Ouverture du compte par Otsu depuis l'espace du rôle : credential de Bari, Batch du wallet, puis l'espace. */
async function openWithOtsu(page: Page, credential: string, fillProfile: () => Promise<void>): Promise<void> {
  await page.getByRole("button", { name: "Connect Otsu wallet" }).click();
  await expect(page.getByTestId("wallet-registration")).toBeVisible({ timeout: ONBOARDING_TIMEOUT_MS });
  await fillProfile();
  await page.getByRole("button", { name: "Create my account" }).click();
  const onboarding = page.getByTestId("wallet-onboarding");
  await expect(onboarding.getByRole("heading", { name: "Your account is ready." })).toBeVisible({ timeout: ONBOARDING_TIMEOUT_MS });
  await expect(onboarding.getByTestId("verification-steps")).toContainText(`${credential} credential issued by Bari`);
  await expect(onboarding.getByTestId("verification-steps")).toContainText("All steps signed at once (Batch)");
  await onboarding.getByRole("button", { name: "Open my space" }).click();
}

test("the pitch walkthrough, end to end in the real product", async ({ browser }) => {
  test.setTimeout(15 * 60_000);
  const id = uniqueDigits(11);
  const company = `E2E Walkthrough ${id} S.r.l.`;
  const vatNumber = `IT${id}`;
  const number = `FT-WALK-${Date.now().toString(36).toUpperCase()}`;
  const visitor = await actor(browser);
  const lender = await actor(browser);
  const business = await actor(browser);
  const publicBody = await actor(browser);
  const lenderWallet: OtsuMock = await installOtsuMock(lender);
  const businessWallet: OtsuMock = await installOtsuMock(business);
  let signedFile: { name: string; mimeType: string; buffer: Buffer } | undefined;
  let loanId: string | undefined;

  try {
    await test.step("1. landing: three doors and the Transparency link", async () => {
      await visitor.goto("/#/");
      for (const action of ["Start lending", "Confirm an invoice", "Get paid now"]) {
        await expect(visitor.getByRole("link", { name: action })).toBeVisible();
      }
      await expect(visitor.getByRole("link", { name: "Transparency" }).first()).toBeVisible();
      await capture(visitor, "walkthrough-01-landing");
    });

    await test.step("2. lender: connects Otsu with light KYC, adds test RLUSD, deposits 5,000 RLUSD signed in Otsu", async () => {
      await lender.goto("/#/lend");
      await openWithOtsu(lender, "KYC_INVESTOR", async () => {
        await lender.getByLabel("Full name").fill("Ada Lovelace");
        await lender.getByLabel("Country of residence").selectOption({ label: "Italy" });
        await lender.getByLabel("I understand my capital is at risk.").check();
      });
      await expect(lender).toHaveURL(/#\/lend$/);
      await expect(lender.getByTestId("account-card")).toContainText("your XRPL wallet, connected with Otsu");

      await lender.getByRole("button", { name: "Add test RLUSD" }).click();
      await expect(lender.getByTestId("lend-done-faucet")).toContainText("Received 10,000.00 RLUSD", { timeout: TX_TIMEOUT_MS });
      // Le montant n'est contrôlé que contre la position relue après le faucet.
      await expect(lender.getByTestId("lend-balance")).toHaveText("10,000.00 RLUSD");
      const form = lender.getByTestId("lend-deposit");
      await form.getByLabel("Amount in RLUSD").fill("5000");
      await form.getByRole("button", { name: "Deposit", exact: true }).click();
      const done = lender.getByTestId("lend-done-deposit");
      await expect(done).toContainText("Deposited 5,000.00 RLUSD", { timeout: TX_TIMEOUT_MS });
      expect((await succeededHashes(lenderWallet, done)).length).toBeGreaterThan(0);
      expect(await ledgerShares(lenderWallet)).toBeGreaterThan(0n);
      await expect(lender.getByTestId("lend-shares")).not.toHaveText("0.00");
      await expect(lender.getByTestId("lend-value")).toHaveText(/^(4,999\.\d\d|5,000\.00) RLUSD$/);
      await expect(lender.getByTestId("lend-yield")).toContainText("% a year");
      await capture(lender, "walkthrough-02-lender-deposit");
    });

    await test.step("3. business: connects Otsu with light KYB", async () => {
      await business.goto("/#/business");
      await openWithOtsu(business, "KYB_PME", async () => {
        await business.getByLabel("Company name").fill(company);
        await business.getByLabel("VAT number").fill(vatNumber);
      });
      await expect(business).toHaveURL(/#\/business$/);
      await expect(business.getByRole("heading", { name: "Ask your client to confirm your invoice on Bari." })).toBeVisible();
      await expect(business.getByTestId("account-card")).toContainText(company);
      await capture(business, "walkthrough-03-business");
    });

    await test.step("4. public body: reads the FatturaPA, confirms and signs it", async () => {
      await signInPublicBody(publicBody);
      const issueDate = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
      const xml = fatturaPaXml({
        supplier: { ...PITCH_SUPPLIER, name: company, vatNumber },
        customer: REGIONE_PUGLIA,
        number,
        issueDate,
        dueDate: new Date(issueDate.getTime() + TERM_DAYS * MS_PER_DAY),
        totalCents: TOTAL_CENTS,
        description: "Manutenzione impianti, sede di via Gentile",
      });
      await publicBody.goto("/#/public");
      await publicBody
        .getByTestId("drop-input")
        .setInputFiles({ name: `${number}.xml`, mimeType: "application/xml", buffer: Buffer.from(xml) });
      await expect(publicBody.getByText(company, { exact: true })).toBeVisible();
      await expect(publicBody.getByText("$10,340.00", { exact: true })).toBeVisible();
      const download = publicBody.waitForEvent("download");
      await publicBody.getByRole("button", { name: "Confirm and sign" }).click();
      await expect(publicBody.getByRole("heading", { name: "Signed. Send this PDF to your supplier" })).toBeVisible();
      const saved = await download;
      expect(saved.suggestedFilename()).toBe(`${number}.signed.pdf`);
      signedFile = {
        name: saved.suggestedFilename(),
        mimeType: "application/pdf",
        buffer: await readFile(await saved.path()),
      };
      await capture(publicBody, "walkthrough-04-public-body-signed");
    });

    const dropSigned = async () => {
      expect(signedFile).toBeDefined();
      if (signedFile !== undefined) await business.getByTestId("drop-input").setInputFiles(signedFile);
    };

    await test.step("5. business drops the signed file: checks pass, offer of 9,000 now", async () => {
      await dropSigned();
      const checks = business.getByTestId("invoice-checks");
      await expect(checks.locator(".check")).toHaveCount(7);
      await expect(checks.locator(".check.fail")).toHaveCount(0);
      await expect(business.locator(".offer-row", { hasText: /^Advance/ })).toContainText("$9,000.00");
      await expect(business.locator(".offer-row", { hasText: /^Proven tier/ })).toContainText("$10,000.00");
      await capture(business, "walkthrough-05-business-offer");
    });

    await test.step("6. Get paid now: certificate and loan signed in Otsu, 8,955 RLUSD received, the certificate shows the decoded proof", async () => {
      const loanResponse = business.waitForResponse((response) => response.url().endsWith("/api/sme/loan/submit"), {
        timeout: FUNDING_TIMEOUT_MS,
      });
      await business.getByRole("button", { name: "Get paid now" }).click();
      const response = await loanResponse;
      expect(response.status(), await response.text()).toBe(HTTP_CREATED);
      const loan = (await response.json()) as LoanResponse;
      loanId = loan.loanId;
      expect(loan.transactions.map((tx) => tx.result)).toEqual(loan.transactions.map(() => "tesSUCCESS"));
      await expect(business.getByTestId("business-funded")).toContainText("8,955.00 RLUSD");
      const steps = business.getByTestId("funding-steps");
      await expect(steps.locator("li.done")).toHaveCount(6);
      await expect(steps.locator('li[data-step="signCertificate"]')).toContainText("Sign the certificate in Otsu");
      await expect(steps.locator('li[data-step="signLoan"]')).toContainText("Sign the loan in Otsu");
      await capture(business, "walkthrough-06-business-funded");

      await steps.locator('li[data-step="certificate"] a').click();
      await expect(business).toHaveURL(/#\/tx\/[0-9A-F]{64}$/);
      await expect(business.getByRole("heading", { name: "Invoice certificate" })).toBeVisible({ timeout: 30_000 });
      await expect(business.locator(".offer-row", { hasText: "Proven minimum amount" })).toContainText("$10,000.00");
      await capture(business, "walkthrough-06-certificate");
      await business.goBack();
      await expect(business).toHaveURL(/#\/business$/);
    });

    await test.step("7. the same file again: Already financed, with the registration link", async () => {
      await dropSigned();
      const duplicate = business.getByTestId("business-duplicate");
      await expect(duplicate.getByRole("heading", { name: "Already financed" })).toBeVisible({ timeout: 60_000 });
      await expect(duplicate.locator(TX_LINK)).toHaveCount(1);
      await capture(business, "walkthrough-07-business-duplicate");
    });

    await test.step("8. transparency: every proof verified in the visitor's browser", async () => {
      await visitor.goto("/#/transparency");
      const status = visitor.getByTestId("transparency-verification");
      await expect(status).toHaveText(SUMMARY, { timeout: AUDIT_TIMEOUT_MS });
      const [, verified, total] = SUMMARY.exec(await status.innerText()) ?? [];
      expect(Number(verified)).toBeGreaterThanOrEqual(2);
      expect(verified).toBe(total);
      await capture(visitor, "walkthrough-08-transparency");
    });

    await test.step("9. lender withdraws now through Bari, signed in Otsu: RLUSD come back", async () => {
      const form = lender.getByTestId("lend-withdraw");
      await form.getByRole("button", { name: "All my shares" }).click();
      await form.getByRole("button", { name: "Withdraw", exact: true }).click();
      const done = lender.getByTestId("lend-done-withdraw");
      await expect(done).toContainText("Sold", { timeout: TX_TIMEOUT_MS });
      expect((await succeededHashes(lenderWallet, done)).length).toBeGreaterThan(0);
      expect(await ledgerShares(lenderWallet)).toBe(0n);
      await expect(lender.getByTestId("lend-shares")).toHaveText("0.00");
      await expect(lender.getByTestId("lend-balance")).toHaveText(/^9,9\d\d\.\d\d RLUSD$/);
      await capture(lender, "walkthrough-09-lender-withdraw");
    });
  } finally {
    // Remboursé à la fin, signé dans Otsu : un prêt impayé entamerait la first-loss et la limite de concentration du débiteur.
    if (loanId !== undefined) await repayWithOtsu(business, loanId);
    await Promise.all([lenderWallet.close(), businessWallet.close()]);
    for (const page of [visitor, lender, business, publicBody]) await page.context().close();
  }
});
