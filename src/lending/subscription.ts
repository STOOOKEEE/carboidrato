// Phase de souscription : dépôts des investisseurs dans le Vault et mise en première perte de Bari.

import type { Client, Wallet } from "xrpl";
import { INVESTORS, type Actors } from "../accounts/actors.js";
import { INVESTOR_DEPOSITS_EUR } from "../config/finance.js";
import type { Fund } from "../fund/fund.js";
import { eurToUnits, formatEur } from "../lib/amounts.js";
import { log } from "../lib/logger.js";
import { getMptBalance } from "../xrpl/ledgerEntries.js";
import { ledgerTime } from "../xrpl/ledgerTime.js";
import { mptAmount } from "../xrpl/mpt.js";
import { clientSubmitter, submitTx } from "../xrpl/submit.js";
import { bariFirstLossUnits } from "./economics.js";
import { depositToVault } from "./lenderTrades.js";

/** Liquidités de Bari au-delà de sa first-loss (fonds durable), en unités EURc. */
export interface BariLiquidity {
  /** Déposé dans le Vault pendant la souscription : parts gardées en stock pour les prêteurs. */
  shareStock: bigint;
  /** Gardé sur le compte de Bari. */
  reserve: bigint;
}

async function deposit(client: Client, depositor: Wallet, name: string, fund: Fund, units: bigint): Promise<void> {
  await depositToVault(clientSubmitter(client), fund, depositor, units, `VaultDeposit ${name}`);
}

export async function subscribe(client: Client, actors: Actors, fund: Fund, liquidity?: BariLiquidity): Promise<void> {
  if ((await ledgerTime(client)) >= fund.cohort.subscriptionDate) {
    throw new Error("Souscription déjà close : augmenter COHORT_SUBSCRIPTION_S");
  }
  for (const investor of INVESTORS) {
    await deposit(client, actors[investor], investor, fund, eurToUnits(INVESTOR_DEPOSITS_EUR[investor]));
  }

  // Bari, propriétaire du broker, apporte elle-même la first-loss : sa mise est perdue avant celle des investisseurs.
  const cover = bariFirstLossUnits();
  await submitTx(
    client,
    {
      TransactionType: "LoanBrokerCoverDeposit",
      Account: actors.bari.address,
      LoanBrokerID: fund.brokerId,
      Amount: mptAmount(fund.assetId, cover),
    },
    actors.bari,
    `LoanBrokerCoverDeposit first-loss Bari (${formatEur(cover, 2)})`,
  );

  if (liquidity !== undefined) {
    await deposit(client, actors.bari, "bari (stock de parts)", fund, liquidity.shareStock);
    const shares = await getMptBalance(client, fund.cohort.shareMptId, actors.bari.address);
    const reserve = await getMptBalance(client, fund.assetId, actors.bari.address);
    log.info(`Bari : ${shares} parts en stock, réserve ${formatEur(reserve, 2)} hors Vault`);
  }
  log.info("dépôts enregistrés pendant la phase de souscription");
}
