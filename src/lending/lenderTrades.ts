// Ordres d'un prêteur sur son compte géré : dépôt et retrait natifs dans le Vault, ou échange immédiat avec Bari
// en Batch atomique de deux Payment (le Vault fermé refuse dépôts et retraits pendant la période de prêt).

import type { Payment, Wallet } from "xrpl";
import type { Fund } from "../fund/fund.js";
import { formatEur } from "../lib/amounts.js";
import type { PendingInner, SubmitBatch } from "../xrpl/batch.js";
import { mptAmount } from "../xrpl/mpt.js";
import type { SubmitTx, TxOutcome } from "../xrpl/submit.js";

export interface TradeParties {
  fund: Fund;
  bari: Wallet;
  /** Compte géré du prêteur : Bari en détient la clé. */
  lender: Wallet;
}

/** Un échange immédiat : `amount` EURc contre `shares` unités de part. */
export interface ShareTrade {
  amount: bigint;
  shares: bigint;
}

export function depositToVault(
  submit: SubmitTx,
  fund: Fund,
  depositor: Wallet,
  amount: bigint,
  label = "VaultDeposit prêteur",
): Promise<TxOutcome> {
  return submit(
    {
      TransactionType: "VaultDeposit",
      Account: depositor.address,
      VaultID: fund.cohort.vaultId,
      Amount: mptAmount(fund.assetId, amount),
    },
    depositor,
    `${label} (${formatEur(amount, 2)})`,
  );
}

export function withdrawFromVault(
  submit: SubmitTx,
  fund: Fund,
  holder: Wallet,
  shares: bigint,
  label = "VaultWithdraw prêteur",
): Promise<TxOutcome> {
  return submit(
    {
      TransactionType: "VaultWithdraw",
      Account: holder.address,
      VaultID: fund.cohort.vaultId,
      Amount: mptAmount(fund.cohort.shareMptId, shares),
    },
    holder,
    `${label} (${shares} parts)`,
  );
}

function payment(from: Wallet, to: Wallet, issuanceId: string, units: bigint, label: string): PendingInner {
  const tx: Payment = { TransactionType: "Payment", Account: from.address, Destination: to.address, Amount: mptAmount(issuanceId, units) };
  return { tx, label };
}

/** Entrée immédiate : les EURc du prêteur et les parts du stock de Bari changent de main, ou rien ne bouge. */
export function buySharesFromBari(
  submitBatch: SubmitBatch,
  { fund, bari, lender }: TradeParties,
  trade: ShareTrade,
): Promise<TxOutcome> {
  return submitBatch(
    bari,
    lender,
    [
      payment(lender, bari, fund.assetId, trade.amount, `Payment EURc prêteur → bari (${formatEur(trade.amount, 2)})`),
      payment(bari, lender, fund.cohort.shareMptId, trade.shares, `Payment parts bari → prêteur (${trade.shares})`),
    ],
    "Batch entrée immédiate (tfAllOrNothing)",
  );
}

/** Sortie immédiate : Bari rachète les parts du prêteur sur sa réserve EURc. */
export function sellSharesToBari(
  submitBatch: SubmitBatch,
  { fund, bari, lender }: TradeParties,
  trade: ShareTrade,
): Promise<TxOutcome> {
  return submitBatch(
    bari,
    lender,
    [
      payment(lender, bari, fund.cohort.shareMptId, trade.shares, `Payment parts prêteur → bari (${trade.shares})`),
      payment(bari, lender, fund.assetId, trade.amount, `Payment EURc bari → prêteur (${formatEur(trade.amount, 2)})`),
    ],
    "Batch sortie immédiate (tfAllOrNothing)",
  );
}
