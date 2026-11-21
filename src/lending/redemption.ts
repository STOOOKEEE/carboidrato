// Phase de rachat : chaque investisseur rend toutes ses parts et récupère capital + intérêts (ou capital − perte).

import type { Client } from "xrpl";
import { INVESTORS, type Actors } from "../accounts/actors.js";
import { INVESTOR_DEPOSITS_RLUSD } from "../config/finance.js";
import type { Fund } from "../fund/fund.js";
import { formatRlusd, rlusdToUnits } from "../lib/amounts.js";
import { log } from "../lib/logger.js";
import { xrplLedger } from "../xrpl/ledger.js";
import { waitForLedgerTimeAfter } from "../xrpl/ledgerTime.js";
import { clientSubmitter } from "../xrpl/submit.js";
import { withdrawFromVault } from "./lenderTrades.js";

export async function redeemAll(client: Client, actors: Actors, fund: Fund): Promise<void> {
  const submit = clientSubmitter(client);
  const ledger = xrplLedger(client);
  await waitForLedgerTimeAfter(client, fund.cohort.redemptionDate, "ouverture de la phase de rachat");
  for (const investor of INVESTORS) {
    const address = actors[investor].address;
    const shares = await ledger.mptBalance(fund.cohort.shareMptId, address);
    const before = await ledger.stablecoinBalance(fund.stablecoin, address);
    await withdrawFromVault(submit, fund, actors[investor], shares, `VaultWithdraw ${investor}, toutes les parts`);
    const received = (await ledger.stablecoinBalance(fund.stablecoin, address)) - before;
    const deposit = rlusdToUnits(INVESTOR_DEPOSITS_RLUSD[investor]);
    log.info(
      `${investor} : déposé ${formatRlusd(deposit)} → récupéré ${formatRlusd(received)} (${received >= deposit ? "+" : ""}${formatRlusd(received - deposit)})`,
    );
  }
}
