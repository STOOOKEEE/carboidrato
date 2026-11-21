// Phase de rachat : chaque investisseur rend toutes ses parts et récupère capital + intérêts (ou capital − perte).

import type { Client } from "xrpl";
import { INVESTORS, type Actors } from "../accounts/actors.js";
import { INVESTOR_DEPOSITS_EUR } from "../config/finance.js";
import type { Fund } from "../fund/fund.js";
import { eurToUnits, formatEur } from "../lib/amounts.js";
import { log } from "../lib/logger.js";
import { getMptBalance } from "../xrpl/ledgerEntries.js";
import { waitForLedgerTimeAfter } from "../xrpl/ledgerTime.js";
import { clientSubmitter } from "../xrpl/submit.js";
import { withdrawFromVault } from "./lenderTrades.js";

export async function redeemAll(client: Client, actors: Actors, fund: Fund): Promise<void> {
  const submit = clientSubmitter(client);
  await waitForLedgerTimeAfter(client, fund.cohort.redemptionDate, "ouverture de la phase de rachat");
  for (const investor of INVESTORS) {
    const address = actors[investor].address;
    const shares = await getMptBalance(client, fund.cohort.shareMptId, address);
    const before = await getMptBalance(client, fund.assetId, address);
    await withdrawFromVault(submit, fund, actors[investor], shares, `VaultWithdraw ${investor}, toutes les parts`);
    const received = (await getMptBalance(client, fund.assetId, address)) - before;
    const deposit = eurToUnits(INVESTOR_DEPOSITS_EUR[investor]);
    log.info(
      `${investor} : déposé ${formatEur(deposit)} → récupéré ${formatEur(received)} (${received >= deposit ? "+" : ""}${formatEur(received - deposit)})`,
    );
  }
}
