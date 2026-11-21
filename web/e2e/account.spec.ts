// Comptes de bout en bout : inscription d'un prêteur et d'une entreprise sur le réseau, déconnexion, reconnexion, garde.

import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "correct horse battery";
/** Ouverture d'un compte géré : 4 à 5 transactions validées, un ledger toutes les 3 s sur l'AlphaNet. */
const SIGNUP_TIMEOUT_MS = 120_000;

const unique = () => `${Date.now()}${Math.floor(Math.random() * 1_000)}`;

async function expectAccountReady(page: Page, transactions: number): Promise<void> {
  await expect(page.getByRole("heading", { name: "Your account is ready." })).toBeVisible({ timeout: SIGNUP_TIMEOUT_MS });
  const steps = page.getByTestId("verification-steps");
  await expect(steps.locator("li.done")).toHaveCount(transactions);
  await expect(steps.locator('a[href^="#/tx/"]')).toHaveCount(transactions);
  await expect(page.getByText("Verification: basic (self-declared)", { exact: true })).toBeVisible();
}

test("a lender signs up, signs out and signs back in through the lend space", async ({ page }) => {
  const email = `lender-${unique()}@e2e.example`;
  await page.goto("/#/signup/lender");
  await page.getByRole("button", { name: "Create my account" }).click();
  await expect(page.getByText("Tick this box to lend through Bari")).toBeVisible();

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Full name").fill("Ada Lovelace");
  await page.getByLabel("Country of residence").selectOption({ label: "Italy" });
  await page.getByLabel("I understand my capital is at risk.").check();
  await page.getByRole("button", { name: "Create my account" }).click();
  await expect(page.getByRole("heading", { name: "Verifying…" })).toBeVisible();
  await expectAccountReady(page, 5);

  await page.getByRole("link", { name: "Open my space" }).click();
  await expect(page).toHaveURL(/#\/lend$/);
  await expect(page.getByTestId("account-card")).toContainText(email);
  await expect(page.getByTestId("account-card")).toContainText("KYC_INVESTOR");

  await page.getByTestId("account-menu").locator("summary").click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();

  await page.goto("/#/lend");
  await expect(page.getByRole("heading", { name: "Sign in to lend." })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("wrong password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText("Wrong email or password");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("account-card")).toContainText(email);
});

test("a business signs up and is kept out of the lend space", async ({ page }) => {
  const id = unique();
  const email = `ops-${id}@e2e.example`;
  await page.goto("/#/signup/business");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Company name").fill(`E2E Forniture ${id} S.r.l.`);
  await page.getByLabel("VAT number").fill(`IT7${id.slice(-10)}`);
  await page.getByRole("button", { name: "Create my account" }).click();
  await expectAccountReady(page, 4);

  await page.getByRole("link", { name: "Open my space" }).click();
  await expect(page).toHaveURL(/#\/business$/);
  await expect(page.getByRole("heading", { name: "Ask your client to confirm your invoice on Bari." })).toBeVisible();
  await expect(page.getByTestId("account-card")).toContainText("KYB_PME");

  await page.goto("/#/lend");
  await expect(page.getByRole("heading", { name: "This space is for lenders." })).toBeVisible();
  await page.getByRole("link", { name: "Open my space" }).click();
  await expect(page).toHaveURL(/#\/business$/);

  await page.goto("/#/signin");
  await expect(page).toHaveURL(/#\/business$/);
});

test("the landing shows three doors and live fund figures", async ({ page }) => {
  await page.goto("/");
  for (const action of ["Start lending", "Confirm an invoice", "Get paid now"]) {
    await expect(page.getByRole("link", { name: action })).toBeVisible();
  }
  await expect(page.getByTestId("fund-facts")).toHaveAttribute("aria-busy", "false");
  await expect(page.getByTestId("fund-facts")).toContainText("invoices financed");
  await expect(page.getByTestId("fund-facts")).not.toContainText("—");

  await page.getByRole("link", { name: "Confirm an invoice" }).click();
  await expect(page.getByRole("heading", { name: "Sign in to confirm invoices." })).toBeVisible();
  await page.getByRole("link", { name: "Register your public body" }).click();
  await expect(page).toHaveURL(/#\/signup\/public_body$/);
  await expect(page.getByLabel("Public body")).toContainText("Comune di Bari");
});
