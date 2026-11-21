// `npm run demo:fund` : fonds durable ouvert jusqu'au pitch, stock de parts de Bari et deux prêts historiques, repris par l'API.

import { Client, isoTimeToRippleTime, rippleTimeToISOTime } from "xrpl";
import { loadApiConfig } from "../api/fund/config.js";
import { FundStateStore, loanState, type LoanStatus } from "../api/fund/stateStore.js";
import { loadCohortTiming } from "../config/cohort.js";
import { BARI_EURC_RESERVE_EUR, BARI_SHARE_STOCK_EUR } from "../config/finance.js";
import { loadNetworkConfig } from "../config/network.js";
import { VERIFIED_DEBTORS } from "../invoice/debtors.js";
import { buildDemoInvoice } from "../invoice/invoice.js";
import { repayLoan } from "../lending/repayment.js";
import { eurToUnits } from "../lib/amounts.js";
import { log } from "../lib/logger.js";
import { xrplLedger } from "../xrpl/ledger.js";
import { ledgerTime } from "../xrpl/ledgerTime.js";
import { clientSubmitter } from "../xrpl/submit.js";
import { releaseZkResources } from "../zk/index.js";
import { financeInvoice, openFund, type FinancedInvoice } from "./financing.js";
import { isReusable } from "./fundReuse.js";

/** Rachat du fonds durable : la phase d'investissement couvre le pitch et les e2e jusque-là. */
const DURABLE_REDEMPTION_DATE = isoTimeToRippleTime("2027-03-31T00:00:00Z");
const HISTORICAL_LOAN_INDEXES = [1, 2];
/** Pas la Comune di Bari : sa facture en direct (9 % du fonds) doit passer sous la limite de concentration de 20 %. */
const HISTORICAL_DEBTOR = VERIFIED_DEBTORS[1];

async function createFund(client: Client, store: FundStateStore): Promise<void> {
  const { actors, fund } = await openFund(
    client,
    { subscriptionWindowS: loadCohortTiming().subscriptionWindowS, redemptionDate: DURABLE_REDEMPTION_DATE },
    { shareStock: eurToUnits(BARI_SHARE_STOCK_EUR), reserve: eurToUnits(BARI_EURC_RESERVE_EUR) },
  );

  // Même débiteur pour les deux factures : même pseudonyme, la concentration ressort à l'audit.
  const runId = Date.now().toString(36);
  const financed: FinancedInvoice[] = [];
  for (const index of HISTORICAL_LOAN_INDEXES) {
    financed.push(await financeInvoice(client, actors, fund, buildDemoInvoice(HISTORICAL_DEBTOR, runId, index), index));
  }

  // Le premier prêt est déjà soldé : l'historique montre un remboursement et un prêt en cours.
  const [repaid] = financed;
  log.step("Prêt 1 · remboursement (mairie → PME, LoanPay, retour du MPT facture)");
  const demoParties = { mairie: actors.mairie, borrower: actors.sme, bari: actors.bari };
  await repayLoan(clientSubmitter(client), xrplLedger(client), demoParties, fund, repaid.loan);

  // Persisté une fois le fonds complet : une exécution interrompue laisse l'état précédent intact.
  const now = new Date().toISOString();
  store.reset(fund);
  store.update((state) => {
    state.deposited = true;
    for (const entry of financed) {
      const status: LoanStatus = entry === repaid ? "repaid" : "active";
      const { tokenId, certificate } = entry.issued;
      state.invoices.push({ tokenId, certificate, issuedAt: now, owner: actors.sme.address });
      state.loans.push(loanState(entry.loan, actors.sme.address, status, now));
    }
  });
  log.step(`Fonds de démo prêt en ${log.elapsedSeconds()} s`);
  log.info(`Vault ${fund.cohort.vaultId}, rachat dès ${rippleTimeToISOTime(fund.cohort.redemptionDate)}`);
}

async function main(): Promise<void> {
  const network = loadNetworkConfig();
  const store = new FundStateStore(loadApiConfig(network).stateFile);
  const client = new Client(network.wsUrl);
  await client.connect();
  try {
    const current = store.current;
    if (current !== undefined && isReusable(current, await ledgerTime(client))) {
      log.info(
        `fonds réutilisé : Vault ${current.fund.cohort.vaultId} en phase d'investissement jusqu'à ${rippleTimeToISOTime(current.fund.cohort.redemptionDate)}`,
      );
      return;
    }
    await createFund(client, store);
  } finally {
    await client.disconnect();
    await releaseZkResources();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
