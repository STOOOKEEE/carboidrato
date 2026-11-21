// Connexion par wallet Otsu de bout en bout (faux Otsu qui signe dans Node) : wallet neuf activé par Bari, KYC léger,
// ouverture du compte (credential de Bari, Batch signé dans le wallet, vérifiés sur le ledger), espace du rôle,
// déconnexion puis reconnexion directe.

import { expect, test, type Page } from "@playwright/test";
import { convertHexToString, type LedgerEntry } from "@xrpl-commons/xrpl";
import { capture } from "./capture";
import { installOtsuMock, type OtsuMock } from "./fixtures/otsuMock";

/** Activation du wallet par Bari (un Payment validé) puis signature : quelques ledgers de 3 s sur l'AlphaNet. */
const WALLET_TIMEOUT_MS = 60_000;
/** Credential émis par Bari puis Batch signé dans le wallet : deux transactions validées l'une après l'autre. */
const ONBOARDING_TIMEOUT_MS = 90_000;
const BATCH_LABEL = "All steps signed at once (Batch)";
/** « RLUSD » en code de devise non standard (20 octets hex). */
const RLUSD_CURRENCY = "524C555344000000000000000000000000000000";
/** Flag lsfAccepted d'un objet Credential. */
const LSF_ACCEPTED = 0x00010000;

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

/** Ce que détient le wallet sur le ledger validé : credentials acceptés, lignes de confiance, autorisations MPT. */
async function holdings({ client, wallet }: OtsuMock) {
  const objects = async (type: "credential" | "state" | "mptoken") =>
    (await client.request({ command: "account_objects", account: wallet.address, type, ledger_index: "validated" })).result
      .account_objects as LedgerEntry.LedgerEntry[];
  const [credentials, lines, mptokens] = await Promise.all([objects("credential"), objects("state"), objects("mptoken")]);
  return {
    acceptedCredentials: credentials
      .filter((entry): entry is LedgerEntry.Credential => entry.LedgerEntryType === "Credential")
      .filter((entry) => entry.Subject === wallet.address && (Number(entry.Flags) & LSF_ACCEPTED) !== 0)
      .map((entry) => convertHexToString(entry.CredentialType)),
    rlusdLines: lines.filter(
      (entry) => entry.LedgerEntryType === "RippleState" && [entry.HighLimit, entry.LowLimit].some((limit) => limit.currency === RLUSD_CURRENCY),
    ).length,
    mptokens: mptokens.length,
  };
}

/** Écran d'ouverture du compte jusqu'au bout : étapes attendues, Batch du wallet validé en tesSUCCESS. */
async function finishOnboarding(page: Page, mock: OtsuMock, shot: string, labels: string[]): Promise<void> {
  const onboarding = page.getByTestId("wallet-onboarding");
  await expect(onboarding.getByRole("heading", { name: "Your account is ready." })).toBeVisible({ timeout: ONBOARDING_TIMEOUT_MS });
  const steps = onboarding.getByTestId("verification-steps").locator("li");
  await expect(steps).toHaveText(labels.map((label) => new RegExp(label.replace(/[()]/g, "\\$&"))));
  const batchHash = await steps.filter({ hasText: BATCH_LABEL }).locator("a").getAttribute("title");
  expect(batchHash).toMatch(/^[0-9A-F]{64}$/);
  const batch = await mock.client.request({ command: "tx", transaction: batchHash ?? "" });
  expect(batch.result.validated).toBe(true);
  expect(typeof batch.result.meta === "object" ? batch.result.meta.TransactionResult : batch.result.meta).toBe("tesSUCCESS");
  await capture(page, shot);
  await onboarding.getByRole("button", { name: "Open my space" }).click();
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

  await finishOnboarding(page, otsu, "wallet-onboarding-lender", [
    "KYC_INVESTOR credential issued by Atlas",
    "Accept your KYC credential",
    "Open your RLUSD trust line",
    "Authorize vault shares",
    BATCH_LABEL,
  ]);
  expect(await holdings(otsu)).toEqual({ acceptedCredentials: ["KYC_INVESTOR"], rlusdLines: 1, mptokens: 1 });

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

  await finishOnboarding(page, otsu, "wallet-onboarding-business", [
    "KYB_PME credential issued by Atlas",
    "Accept your KYB credential",
    "Open your RLUSD trust line",
    BATCH_LABEL,
  ]);
  expect(await holdings(otsu)).toEqual({ acceptedCredentials: ["KYB_PME"], rlusdLines: 1, mptokens: 0 });

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
