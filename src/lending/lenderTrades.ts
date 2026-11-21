// Ordres d'un prêteur : dépôt et retrait natifs dans le Vault, ou échange immédiat avec Bari en Batch atomique de deux
// Payment (le Vault fermé refuse dépôts et retraits pendant la période de prêt). Les transactions se construisent à
// partir des adresses seules (un wallet signe lui-même) ; le compte géré les soumet signées par Bari.

import type { Payment, VaultDeposit, VaultWithdraw, Wallet } from "xrpl";
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

/** Adresses des deux comptes d'un échange immédiat. */
export interface TradeAccounts {
  bari: string;
  lender: string;
}

/** Un échange immédiat : `amount` unités RLUSD contre `shares` unités de part. */
export interface ShareTrade {
  amount: bigint;
  shares: bigint;
}

export function vaultDeposit(fund: Fund, account: string, amount: bigint): VaultDeposit {
  return { TransactionType: "VaultDeposit", Account: account, VaultID: fund.cohort.vaultId, Amount: stablecoinAmount(fund.stablecoin, amount) };
}

export function vaultWithdraw(fund: Fund, account: string, shares: bigint): VaultWithdraw {
  return { TransactionType: "VaultWithdraw", Account: account, VaultID: fund.cohort.vaultId, Amount: mptAmount(fund.cohort.shareMptId, shares) };
}

export function depositToVault(
  submit: SubmitTx,
  fund: Fund,
  depositor: Wallet,
  amount: bigint,
  label = "VaultDeposit prêteur",
): Promise<TxOutcome> {
  return submit(vaultDeposit(fund, depositor.address, amount), depositor, `${label} (${formatRlusd(amount, 2)})`);
}

export function withdrawFromVault(
  submit: SubmitTx,
  fund: Fund,
  holder: Wallet,
  shares: bigint,
  label = "VaultWithdraw prêteur",
): Promise<TxOutcome> {
  return submit(vaultWithdraw(fund, holder.address, shares), holder, `${label} (${shares} parts)`);
}

function rlusdPayment(fund: Fund, from: string, to: string, units: bigint, label: string): PendingInner {
  return { tx: stablecoinPayment(fund.stablecoin, from, to, units), label: `${label} (${formatRlusd(units, 2)})` };
}

function sharePayment(fund: Fund, from: string, to: string, shares: bigint, label: string): PendingInner {
  const tx: Payment = { TransactionType: "Payment", Account: from, Destination: to, Amount: mptAmount(fund.cohort.shareMptId, shares) };
  return { tx, label: `${label} (${shares})` };
}

/** Entrée immédiate : les RLUSD du prêteur et les parts du stock de Bari changent de main, ou rien ne bouge. */
export function entryPayments(fund: Fund, { bari, lender }: TradeAccounts, trade: ShareTrade): PendingInner[] {
  return [
    rlusdPayment(fund, lender, bari, trade.amount, "Payment RLUSD prêteur → bari"),
    sharePayment(fund, bari, lender, trade.shares, "Payment parts bari → prêteur"),
  ];
}

/** Sortie immédiate : Bari rachète les parts du prêteur sur sa réserve RLUSD. */
export function exitPayments(fund: Fund, { bari, lender }: TradeAccounts, trade: ShareTrade): PendingInner[] {
  return [
    sharePayment(fund, lender, bari, trade.shares, "Payment parts prêteur → bari"),
    rlusdPayment(fund, bari, lender, trade.amount, "Payment RLUSD bari → prêteur"),
  ];
}

export function buySharesFromBari(
  submitBatch: SubmitBatch,
  { fund, bari, lender }: TradeParties,
  trade: ShareTrade,
): Promise<TxOutcome> {
  const payments = entryPayments(fund, { bari: bari.address, lender: lender.address }, trade);
  return submitBatch(bari, lender, payments, "Batch entrée immédiate (tfAllOrNothing)");
}

export function sellSharesToBari(
  submitBatch: SubmitBatch,
  { fund, bari, lender }: TradeParties,
  trade: ShareTrade,
): Promise<TxOutcome> {
  const payments = exitPayments(fund, { bari: bari.address, lender: lender.address }, trade);
  return submitBatch(bari, lender, payments, "Batch sortie immédiate (tfAllOrNothing)");
}
