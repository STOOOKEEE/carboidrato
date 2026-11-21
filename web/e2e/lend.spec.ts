// Espace prêteur de bout en bout : euros de test, dépôt de 5 000 € puis sortie immédiate par Bari, sur le réseau.

import { expect, test } from "@playwright/test";
import { capture } from "./capture";

/** Ouverture d'un compte géré : 5 transactions validées, un ledger toutes les 3 s sur l'AlphaNet. */
const SIGNUP_TIMEOUT_MS = 120_000;
/** Un ordre du prêteur : un Payment, un VaultDeposit ou un Batch, puis la relecture de la position. */
const TX_TIMEOUT_MS = 90_000;
const TX_LINK = 'a[href^="#/tx/"]';

const unique = () => `${Date.now()}${Math.floor(Math.random() * 1_000)}`;

test("a lender adds test euros, deposits 5,000 and withdraws through Bari", async ({ page }) => {
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
    await expect(balance).toHaveText("€0.00");
    await expect(page.getByTestId("lend-shares")).toHaveText("0.00");
    await expect(page.getByTestId("lend-position")).toContainText("Add test euros, then deposit them in the fund.");
    await expect(history).toContainText("Nothing yet in this session.");
    await capture(page, "lend-empty");
  });

  await test.step("add test euros", async () => {
    await page.getByRole("button", { name: "Add test euros" }).click();
    const done = page.getByTestId("lend-done-faucet");
    await expect(done).toContainText("Received €10,000.00 of test euros", { timeout: TX_TIMEOUT_MS });
    await expect(done.locator(TX_LINK)).toBeVisible();
    await expect(balance).toHaveText("€10,000.00");
  });

  await test.step("deposit 5,000 EURc: fund shares arrive", async () => {
    const form = page.getByTestId("lend-deposit");
    const amount = form.getByLabel("Amount in euros");
    await amount.fill("20000");
    await expect(form).toContainText("Above your balance of €10,000.00. Enter at most €10,000.00.");
    await amount.fill("5000");
    await expect(form).toContainText("Immediate, through Bari");
    await expect(form).toContainText("You receive");
    await form.getByRole("button", { name: "Deposit", exact: true }).click();
    const done = page.getByTestId("lend-done-deposit");
    await expect(done).toContainText("Deposited €5,000.00", { timeout: TX_TIMEOUT_MS });
    await expect(done.locator(TX_LINK).first()).toBeVisible();
    await expect(balance).toHaveText("€5,000.00");
    await expect(page.getByTestId("lend-shares")).not.toHaveText("0.00");
    await expect(page.getByTestId("lend-value")).toHaveText(/^€(4,999\.\d\d|5,000\.00)$/);
    await expect(page.getByTestId("lend-yield")).toContainText("% a year");
    await expect(history.locator("li")).toHaveCount(2);
    await expect(history).toContainText("Deposited €5,000.00");
    await capture(page, "lend");
  });

  await test.step("withdraw every share now through Bari: EURc come back", async () => {
    const form = page.getByTestId("lend-withdraw");
    await form.getByRole("button", { name: "All my shares" }).click();
    await expect(form).toContainText("(0.5%)");
    await form.getByRole("button", { name: "Withdraw", exact: true }).click();
    const done = page.getByTestId("lend-done-withdraw");
    await expect(done).toContainText("Sold", { timeout: TX_TIMEOUT_MS });
    await expect(page.getByTestId("lend-shares")).toHaveText("0.00");
    await expect(balance).toHaveText(/^€9,9\d\d\.\d\d$/);
    await expect(history.locator("li")).toHaveCount(3);
    await expect(history.locator(TX_LINK)).toHaveCount(3);

    await done.locator(TX_LINK).first().click();
    await expect(page).toHaveURL(/#\/tx\/[0-9A-F]{64}$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/ succeeded$/, { timeout: TX_TIMEOUT_MS });
  });
});
