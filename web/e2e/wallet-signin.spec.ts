// Connexion par wallet Otsu de bout en bout (faux Otsu qui signe dans Node) : wallet neuf activé par Bari, KYC léger,
// espace du rôle, déconnexion puis reconnexion directe.

import { expect, test, type Page } from "@playwright/test";
import { capture } from "./capture";
import { installOtsuMock, type OtsuMock } from "./fixtures/otsuMock";

/** Activation du wallet par Bari (un Payment validé) puis signature : quelques ledgers de 3 s sur l'AlphaNet. */
const WALLET_TIMEOUT_MS = 60_000;

const unique = () => `${Date.now()}${Math.floor(Math.random() * 1_000)}`;
const handle = (address: string) => `${address.slice(0, 6)}…${address.slice(-5)}`;

let otsu: OtsuMock | undefined;

test.afterEach(async () => {
  await otsu?.close();
  otsu = undefined;
});

async function connect(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Connect Otsu wallet" }).click();
}

test("a new wallet opens a lender account, signs out and connects straight back in", async ({ page }) => {
  otsu = await installOtsuMock(page);
  const { address } = otsu.wallet;
  await page.goto("/#/signin");
  await expect(page.getByRole("button", { name: "Connect Otsu wallet" })).toHaveAttribute("data-primary", "");
  await expect(page.getByRole("heading", { name: "Continue with email" })).toBeVisible();
  await capture(page, "signin-wallet");

  await connect(page);
  const registration = page.getByTestId("wallet-registration");
  await expect(registration).toBeVisible({ timeout: WALLET_TIMEOUT_MS });
  await expect(registration).toContainText(address);
  await page.getByLabel("Account type").selectOption("lender");
  await page.getByLabel("Full name").fill("Wanda Verdi");
  await page.getByLabel("Country of residence").selectOption({ label: "Italy" });
  await page.getByLabel("I understand my capital is at risk.").check();
  await page.getByRole("button", { name: "Create my account" }).click();

  await expect(page).toHaveURL(/#\/lend$/);
  await expect(page.getByTestId("account-card")).toContainText("Wanda Verdi");
  await expect(page.getByTestId("account-card")).toContainText("your XRPL wallet, connected with Otsu");
  const menu = page.getByTestId("account-menu");
  await expect(menu.locator("summary")).toHaveText(handle(address));

  await menu.locator("summary").click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();

  await page.goto("/#/signin");
  await connect(page);
  await expect(page).toHaveURL(/#\/lend$/, { timeout: WALLET_TIMEOUT_MS });
  await expect(page.getByTestId("account-menu").locator("summary")).toHaveText(handle(address));
});

test("a new wallet opens a business account from the business space", async ({ page }) => {
  otsu = await installOtsuMock(page);
  const id = unique();
  await page.goto("/#/business");
  await expect(page.getByRole("heading", { name: "Sign in to get paid." })).toBeVisible();
  await connect(page);
  await expect(page.getByTestId("wallet-registration")).toBeVisible({ timeout: WALLET_TIMEOUT_MS });
  await expect(page.getByLabel("Account type")).toHaveCount(0);
  await page.getByLabel("Company name").fill(`E2E Wallet ${id} S.r.l.`);
  await page.getByLabel("VAT number").fill(`IT8${id.slice(-10)}`);
  await page.getByRole("button", { name: "Create my account" }).click();

  await expect(page).toHaveURL(/#\/business$/);
  await expect(page.getByTestId("account-card")).toContainText(`E2E Wallet ${id} S.r.l.`);
  await expect(page.getByTestId("account-menu").locator("summary")).toHaveText(handle(otsu.wallet.address));
});

test("a public body is offered email sign-in only", async ({ page }) => {
  await page.goto("/#/public");
  await expect(page.getByRole("heading", { name: "Sign in to confirm invoices." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect Otsu wallet" })).toHaveCount(0);
});

test("without Otsu, the page explains how to get it", async ({ page }) => {
  await page.goto("/#/signin");
  await connect(page);
  await expect(page.getByRole("alert")).toContainText("Otsu wallet is not installed");
  await expect(page.getByRole("link", { name: "Get Otsu wallet" })).toHaveAttribute("href", "https://github.com/RomThpt/otsu-wallet");
});
