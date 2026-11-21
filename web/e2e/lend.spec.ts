// Espace prêteur de bout en bout : RLUSD de test, dépôt de 5 000 RLUSD puis sortie immédiate par Bari, sur le réseau ;
// le même parcours pour un wallet Otsu (faux Otsu qui signe dans Node), chaque ordre signé dans le wallet.

import { expect, test } from "@playwright/test";
import { capture } from "./capture";
import { ledgerShares, succeededHashes } from "./fixtures/otsuLedger";
import { installOtsuMock, type OtsuMock } from "./fixtures/otsuMock";

/** Ouverture d'un compte géré : 5 transactions validées, un ledger toutes les 3 s sur l'AlphaNet. */
const SIGNUP_TIMEOUT_MS = 120_000;
/** Un ordre du prêteur : un Payment, un VaultDeposit ou un Batch, puis la relecture de la position. */
const TX_TIMEOUT_MS = 90_000;
const TX_LINK = 'a[href^="#/tx/"]';

const unique = () => `${Date.now()}${Math.floor(Math.random() * 1_000)}`;
/** Activation du wallet, puis credential de Bari et Batch d'ouverture signé dans le wallet. */
const ONBOARDING_TIMEOUT_MS = 120_000;

let otsu: OtsuMock | undefined;

test.afterEach(async () => {
  await otsu?.close();
  otsu = undefined;
});

test("a lender adds test RLUSD, deposits 5,000 and withdraws through Bari", async ({ page }) => {
  const balance = page.getByTestId("lend-balance");
  const history = page.getByTestId("lend-history");

  await test.step("sign up a new lender and open the lend space", async () => {
    // La requête partage les cookies de la page : la session ouverte ici est celle de l'onglet.
    const response = await page.request.post("/api/auth/signup", {
      data: {
        email: `lender-${unique()}@e2e.example`,
        password: "correct horse battery",
        role: "lender",
        profile: { name: "Grace Hopper", country: "IT", riskAcknowledged: true },
      },
      timeout: SIGNUP_TIMEOUT_MS,
    });
    expect(response.ok()).toBe(true);
    await page.goto("/#/lend");
    await expect(page.getByTestId("account-card")).toContainText("KYC_INVESTOR");
    await expect(balance).toHaveText("0.00 RLUSD");
    await expect(page.getByTestId("lend-shares")).toHaveText("0.00");
    await expect(page.getByTestId("lend-position")).toContainText("Add test RLUSD, then deposit them in the fund.");
    await expect(history).toContainText("Nothing yet in this session.");
    await capture(page, "lend-empty");
  });

  await test.step("add test RLUSD", async () => {
    await page.getByRole("button", { name: "Add test RLUSD" }).click();
    const done = page.getByTestId("lend-done-faucet");
    await expect(done).toContainText("Received 10,000.00 RLUSD of test funds", { timeout: TX_TIMEOUT_MS });
    await expect(done.locator(TX_LINK)).toBeVisible();
    await expect(balance).toHaveText("10,000.00 RLUSD");
  });

  await test.step("deposit 5,000 RLUSD: fund shares arrive", async () => {
    const form = page.getByTestId("lend-deposit");
    const amount = form.getByLabel("Amount in RLUSD");
    await amount.fill("20000");
    await expect(form).toContainText("Above your balance of 10,000.00 RLUSD. Enter at most 10,000.00 RLUSD.");
    await amount.fill("5000");
    await expect(form).toContainText("Immediate, through Bari");
    await expect(form).toContainText("You receive");
    await form.getByRole("button", { name: "Deposit", exact: true }).click();
    const done = page.getByTestId("lend-done-deposit");
    await expect(done).toContainText("Deposited 5,000.00 RLUSD", { timeout: TX_TIMEOUT_MS });
    await expect(done.locator(TX_LINK).first()).toBeVisible();
    await expect(balance).toHaveText("5,000.00 RLUSD");
    await expect(page.getByTestId("lend-shares")).not.toHaveText("0.00");
    await expect(page.getByTestId("lend-value")).toHaveText(/^(4,999\.\d\d|5,000\.00) RLUSD$/);
    await expect(page.getByTestId("lend-yield")).toContainText("% a year");
    await expect(history.locator("li")).toHaveCount(2);
    await expect(history).toContainText("Deposited 5,000.00 RLUSD");
    await capture(page, "lend");
  });

  await test.step("withdraw every share now through Bari: RLUSD come back", async () => {
    const form = page.getByTestId("lend-withdraw");
    await form.getByRole("button", { name: "All my shares" }).click();
    await expect(form).toContainText("(0.5%)");
    await form.getByRole("button", { name: "Withdraw", exact: true }).click();
    const done = page.getByTestId("lend-done-withdraw");
    await expect(done).toContainText("Sold", { timeout: TX_TIMEOUT_MS });
    await expect(page.getByTestId("lend-shares")).toHaveText("0.00");
    await expect(balance).toHaveText(/^9,9\d\d\.\d\d RLUSD$/);
    await expect(history.locator("li")).toHaveCount(3);
    await expect(history.locator(TX_LINK)).toHaveCount(3);

    await done.locator(TX_LINK).first().click();
    await expect(page).toHaveURL(/#\/tx\/[0-9A-F]{64}$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/ succeeded$/, { timeout: TX_TIMEOUT_MS });
  });
});

test("a wallet lender signs a deposit and a withdrawal in Otsu", async ({ page }) => {
  const mock = await installOtsuMock(page);
  otsu = mock;
  const balance = page.getByTestId("lend-balance");

  await test.step("connect a new wallet, register as a lender and open the account", async () => {
    await page.goto("/#/signin");
    await page.getByRole("button", { name: "Connect Otsu wallet" }).click();
    await expect(page.getByTestId("wallet-registration")).toBeVisible({ timeout: ONBOARDING_TIMEOUT_MS });
    await page.getByLabel("Account type").selectOption("lender");
    await page.getByLabel("Full name").fill(`Wanda Verdi ${unique()}`);
    await page.getByLabel("Country of residence").selectOption({ label: "Italy" });
    await page.getByLabel("I understand my capital is at risk.").check();
    await page.getByRole("button", { name: "Create my account" }).click();
    const onboarding = page.getByTestId("wallet-onboarding");
    await expect(onboarding.getByRole("heading", { name: "Your account is ready." })).toBeVisible({ timeout: ONBOARDING_TIMEOUT_MS });
    await onboarding.getByRole("button", { name: "Open my space" }).click();
    await expect(page).toHaveURL(/#\/lend$/);
    await expect(balance).toHaveText("0.00 RLUSD");
  });

  await test.step("add test RLUSD to the wallet", async () => {
    await page.getByRole("button", { name: "Add test RLUSD" }).click();
    await expect(page.getByTestId("lend-done-faucet")).toContainText("Received 10,000.00 RLUSD of test funds", { timeout: TX_TIMEOUT_MS });
    await expect(balance).toHaveText("10,000.00 RLUSD");
  });

  await test.step("deposit 100 RLUSD, signed in Otsu: shares arrive in the wallet", async () => {
    const form = page.getByTestId("lend-deposit");
    await form.getByLabel("Amount in RLUSD").fill("100");
    await expect(form).toContainText("Immediate, through Bari");
    await expect(form).toContainText("You receive");
    await form.getByRole("button", { name: "Deposit", exact: true }).click();
    const done = page.getByTestId("lend-done-deposit");
    await expect(done).toContainText("Deposited 100.00 RLUSD", { timeout: TX_TIMEOUT_MS });
    // Batch signé dans Otsu (BatchSigners de Bari) et ses deux Payment.
    expect(await succeededHashes(mock, done)).toHaveLength(3);
    await expect(balance).toHaveText("9,900.00 RLUSD");
    await expect(page.getByTestId("lend-shares")).not.toHaveText("0.00");
    expect(await ledgerShares(mock)).toBeGreaterThan(0n);
    await capture(page, "lend-wallet");
  });

  await test.step("withdraw every share right away, signed in Otsu: RLUSD come back", async () => {
    const form = page.getByTestId("lend-withdraw");
    await form.getByRole("button", { name: "All my shares" }).click();
    await form.getByRole("button", { name: "Withdraw", exact: true }).click();
    const done = page.getByTestId("lend-done-withdraw");
    await expect(done).toContainText("Sold", { timeout: TX_TIMEOUT_MS });
    expect(await succeededHashes(mock, done)).toHaveLength(3);
    await expect(page.getByTestId("lend-shares")).toHaveText("0.00");
    await expect(balance).toHaveText(/^9,9\d\d\.\d\d RLUSD$/);
    expect(await ledgerShares(mock)).toBe(0n);
  });
});
