// Ce que les e2e Otsu vérifient sur le ledger (transactions d'un ordre, parts détenues) et le remboursement signé dans Otsu.

import { expect, type Locator, type Page } from "@playwright/test";
import type { PreparedSignature } from "../../../src/api/contract";
import type { OtsuMock } from "./otsuMock";

const HTTP_OK = 200;
const TX_LINK = 'a[href^="#/tx/"]';
/** LoanPay préparé par Bari, signé dans Otsu, puis soumis et validé. */
const REPAY_TIMEOUT_MS = 180_000;

/** Ce que le faux Otsu expose à la page (`window.xrpl`), le seul appel dont les tests ont besoin. */
type OtsuWindow = { xrpl: { signTransaction(tx: Record<string, unknown>): Promise<{ tx_blob: string }> } };

/** Transactions d'un ordre (la principale, et celles d'un Batch), chacune validée en tesSUCCESS sur le ledger. */
export async function succeededHashes(mock: OtsuMock, done: Locator): Promise<string[]> {
  const links = await done.locator(TX_LINK).evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute("title") ?? ""));
  const hashes = [...new Set(links)];
  for (const hash of hashes) {
    const { result } = await mock.client.request({ command: "tx", transaction: hash });
    expect(result.validated).toBe(true);
    expect(typeof result.meta === "object" ? result.meta.TransactionResult : result.meta).toBe("tesSUCCESS");
  }
  return hashes;
}

/** Parts du fonds détenues par le wallet (`MPTAmount` des objets MPToken, en chaîne décimale), lues sur le ledger validé. */
export async function ledgerShares({ client, wallet }: OtsuMock): Promise<bigint> {
  const { result } = await client.request({ command: "account_objects", account: wallet.address, type: "mptoken", ledger_index: "validated" });
  const tokens = result.account_objects as unknown as { MPTAmount?: string }[];
  return tokens.reduce((total, token) => total + BigInt(token.MPTAmount ?? "0"), 0n);
}

/** Remboursement d'un wallet : la mairie paie l'entreprise, puis le LoanPay préparé par Bari est signé dans Otsu. */
export async function repayWithOtsu(page: Page, loanId: string): Promise<void> {
  const prepared = await page.request.post(`/api/loans/${loanId}/repay`, { timeout: REPAY_TIMEOUT_MS });
  expect(prepared.status(), await prepared.text()).toBe(HTTP_OK);
  const { tx } = (await prepared.json()) as PreparedSignature;
  const txBlob = await page.evaluate(
    async (loanPay) => (await (window as unknown as OtsuWindow).xrpl.signTransaction(loanPay)).tx_blob,
    tx,
  );
  const repaid = await page.request.post(`/api/loans/${loanId}/repay/submit`, {
    data: { tx_blob: txBlob },
    timeout: REPAY_TIMEOUT_MS,
  });
  expect(repaid.status(), await repaid.text()).toBe(HTTP_OK);
}
