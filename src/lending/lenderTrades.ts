// Ordres d'un prêteur sur son compte géré : dépôt et retrait natifs dans le Vault, ou échange immédiat avec Bari
// en Batch atomique de deux Payment (le Vault fermé refuse dépôts et retraits pendant la période de prêt).

import type { Payment, Wallet } from "xrpl";
import type { Fund } from "../fund/fund.js";
import { formatRlusd } from "../lib/amounts.js";
import type { PendingInner, SubmitBatch } from "../xrpl/batch.js";
import { mptAmount } from "../xrpl/mpt.js";
import { stablecoinAmount, stablecoinPayment } from "../xrpl/stablecoin.js";
import type { SubmitTx, TxOutcome } from "../xrpl/submit.js";

export interface TradeParties {
  fund: Fund;
  bari: Wallet;
  /** Compte géré du prêteur : Bari en détient la clé. */
  lender: Wallet;
}

/** Un échange immédiat : `amount` unités RLUSD contre `shares` unités de part. */
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
      Amount: stablecoinAmount(fund.stablecoin, amount),
    },
    depositor,
    `${label} (${formatRlusd(amount, 2)})`,
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

function rlusdPayment(fund: Fund, from: Wallet, to: Wallet, units: bigint, label: string): PendingInner {
  return { tx: stablecoinPayment(fund.stablecoin, from.address, to.address, units), label: `${label} (${formatRlusd(units, 2)})` };
}

function sharePayment(fund: Fund, from: Wallet, to: Wallet, shares: bigint, label: string): PendingInner {
  const tx: Payment = { TransactionType: "Payment", Account: from.address, Destination: to.address, Amount: mptAmount(fund.cohort.shareMptId, shares) };
  return { tx, label: `${label} (${shares})` };
}

/** Entrée immédiate : les RLUSD du prêteur et les parts du stock de Bari changent de main, ou rien ne bouge. */
export function buySharesFromBari(
  submitBatch: SubmitBatch,
  { fund, bari, lender }: TradeParties,
  trade: ShareTrade,
): Promise<TxOutcome> {
  return submitBatch(
    bari,
    lender,
    [
      rlusdPayment(fund, lender, bari, trade.amount, "Payment RLUSD prêteur → bari"),
      sharePayment(fund, bari, lender, trade.shares, "Payment parts bari → prêteur"),
    ],
    "Batch entrée immédiate (tfAllOrNothing)",
  );
}

/** Sortie immédiate : Bari rachète les parts du prêteur sur sa réserve RLUSD. */
export function sellSharesToBari(
  submitBatch: SubmitBatch,
  { fund, bari, lender }: TradeParties,
  trade: ShareTrade,
): Promise<TxOutcome> {
  return submitBatch(
    bari,
    lender,
    [
      sharePayment(fund, lender, bari, trade.shares, "Payment parts prêteur → bari"),
      rlusdPayment(fund, bari, lender, trade.amount, "Payment RLUSD bari → prêteur"),
    ],
    "Batch sortie immédiate (tfAllOrNothing)",
  );
}
