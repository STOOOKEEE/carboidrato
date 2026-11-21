// Page Transparency sur le réseau : chaque preuve du fonds vérifiée dans le navigateur du visiteur, puis à la demande.

import { expect, test } from "@playwright/test";
import { capture } from "./capture";

/** L'audit relit chaque prêt et son historique sur le ledger, puis le navigateur vérifie chaque preuve. */
const AUDIT_TIMEOUT_MS = 120_000;
const SUMMARY = /(\d+)\/(\d+) proofs verified in your browser/;

test("every proof of the fund is verified in the visitor's browser, then again on demand", async ({ page }) => {
  const status = page.getByTestId("transparency-verification");

  const expectAllVerified = async () => {
    await expect(status).toHaveText(SUMMARY, { timeout: AUDIT_TIMEOUT_MS });
    const [, verified, total] = SUMMARY.exec(await status.innerText()) ?? [];
    expect(Number(verified)).toBeGreaterThanOrEqual(2);
    expect(verified).toBe(total);
    await expect(page.getByTestId("transparency-proofs")).toHaveText(`${verified}/${total}`);
  };

  await test.step("open the page: every proof is verified automatically", async () => {
    await page.goto("/#/transparency");
    await expect(page.locator(".kicker")).toHaveText("Transparency");
    await expectAllVerified();
    await expect(status).toHaveAttribute("data-round", "1");
    await expect(page.getByTestId("transparency-checks")).toContainText("Each invoice financed once");
    const loans = page.getByTestId("transparency-loans");
    await expect(loans.locator("tbody tr").first()).toContainText("Verified");
    await expect(loans.locator('a[href^="#/tx/"]').first()).toBeVisible();
    await expect(page.getByTestId("transparency-exposure").locator(".exposure").first()).toContainText("of the fund");
  });

  await test.step("re-verify in my browser", async () => {
    await page.getByRole("button", { name: "Re-verify in my browser" }).click();
    await expect(status).toHaveAttribute("data-round", "2", { timeout: AUDIT_TIMEOUT_MS });
    await expectAllVerified();
    await expect(page.getByRole("button", { name: "Re-verify in my browser" })).toBeEnabled();
    await capture(page, "transparency");
  });
});
