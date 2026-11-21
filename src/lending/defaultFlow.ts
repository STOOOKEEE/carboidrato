// Scénario de défaut : la PME ne rembourse pas, Bari déprécie puis met les prêts en défaut ; sa first-loss absorbe d'abord.

import { LoanManageFlags, type Client } from "xrpl";
import type { Actors } from "../accounts/actors.js";
import type { Fund } from "../fund/fund.js";
import { formatRlusd } from "../lib/amounts.js";
import { log } from "../lib/logger.js";
import { getLoan, getLoanBroker, getVault } from "../xrpl/ledgerEntries.js";
import { waitForLedgerTimeAfter } from "../xrpl/ledgerTime.js";
import { valueToUnits } from "../xrpl/stablecoin.js";
import { submitTx } from "../xrpl/submit.js";

async function logExposure(client: Client, fund: Fund, moment: string): Promise<void> {
  const broker = await getLoanBroker(client, fund.brokerId);
  const vault = await getVault(client, fund.cohort.vaultId);
  log.info(
    `${moment} : first-loss Bari ${formatRlusd(valueToUnits(broker.CoverAvailable))}, actifs du Vault ${formatRlusd(valueToUnits(vault.AssetsTotal))}, perte latente ${formatRlusd(valueToUnits(vault.LossUnrealized))}`,
  );
}

function manageLoan(client: Client, actors: Actors, loanId: string, flag: LoanManageFlags, label: string) {
  return submitTx(
    client,
    { TransactionType: "LoanManage", Account: actors.bari.address, LoanID: loanId, Flags: flag },
    actors.bari,
    label,
  );
}

export async function defaultLoan(client: Client, actors: Actors, fund: Fund, loanId: string): Promise<void> {
  const loan = await getLoan(client, loanId);
  await logExposure(client, fund, "avant défaut");

  // L'impairment n'est accepté qu'une fois le paiement en retard (sinon tecTOO_SOON).
  await waitForLedgerTimeAfter(client, loan.NextPaymentDueDate, "échéance dépassée sans paiement");
  await manageLoan(client, actors, loanId, LoanManageFlags.tfLoanImpair, "LoanManage tfLoanImpair");
  await logExposure(client, fund, "après impairment");

  await waitForLedgerTimeAfter(client, loan.NextPaymentDueDate + loan.GracePeriod, "fin de la période de grâce");
  await manageLoan(client, actors, loanId, LoanManageFlags.tfLoanDefault, "LoanManage tfLoanDefault");
  await logExposure(client, fund, "après défaut");
  log.info("Bari garde le MPT facture : créance sur la mairie, recouvrée hors chaîne");
}
