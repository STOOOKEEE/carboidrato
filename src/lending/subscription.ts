// Phase de souscription : dépôts des investisseurs dans le Vault et mise en première perte de Bari.

import type { Client } from "xrpl";
import { INVESTORS, type Actors } from "../accounts/actors.js";
import { INVESTOR_DEPOSITS_EUR } from "../config/finance.js";
import type { Fund } from "../fund/fund.js";
import { eurToUnits, formatEur } from "../lib/amounts.js";
import { log } from "../lib/logger.js";
import { ledgerTime } from "../xrpl/ledgerTime.js";
import { mptAmount } from "../xrpl/mpt.js";
import { submitTx } from "../xrpl/submit.js";
import { bariFirstLossUnits } from "./economics.js";

export async function subscribe(client: Client, actors: Actors, fund: Fund): Promise<void> {
  if ((await ledgerTime(client)) >= fund.cohort.subscriptionDate) {
    throw new Error("Souscription déjà close : augmenter COHORT_SUBSCRIPTION_S");
  }
  for (const investor of INVESTORS) {
    const units = eurToUnits(INVESTOR_DEPOSITS_EUR[investor]);
    await submitTx(
      client,
      {
        TransactionType: "VaultDeposit",
        Account: actors[investor].address,
        VaultID: fund.cohort.vaultId,
        Amount: mptAmount(fund.assetId, units),
      },
      actors[investor],
      `VaultDeposit ${investor} (${formatEur(units, 2)})`,
    );
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
  log.info("dépôts enregistrés pendant la phase de souscription");
}
