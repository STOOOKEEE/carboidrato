// `npm run demo:fund` : fonds de démo durable (6 h d'investissement, deux prêts sur le même débiteur) repris par l'API.

import { Client, rippleTimeToISOTime } from "xrpl";
import { loadApiConfig } from "../api/fund/config.js";
import { FundStateStore } from "../api/fund/stateStore.js";
import { loadCohortTiming } from "../config/cohort.js";
import { loadNetworkConfig } from "../config/network.js";
import { VERIFIED_DEBTORS } from "../invoice/debtors.js";
import { buildDemoInvoice } from "../invoice/invoice.js";
import { log } from "../lib/logger.js";
import { ledgerTime } from "../xrpl/ledgerTime.js";
import { releaseZkResources } from "../zk/index.js";
import { financeInvoice, openFund, type FinancedInvoice } from "./financing.js";
import { isReusable } from "./fundReuse.js";

/** Phase d'investissement du fonds durable : de quoi enchaîner démos et e2e sans recréer de cohorte. */
const DURABLE_INVESTMENT_PERIOD_S = "21600";
const HISTORICAL_LOAN_INDEXES = [1, 2];
/** Pas la Comune di Bari : sa facture en direct (9 % du fonds) doit passer sous la limite de concentration de 20 %. */
const HISTORICAL_DEBTOR = VERIFIED_DEBTORS[1];

async function createFund(client: Client, store: FundStateStore): Promise<void> {
  process.env.COHORT_INVESTMENT_S ??= DURABLE_INVESTMENT_PERIOD_S;
  const { actors, fund } = await openFund(client, loadCohortTiming());

  // Même débiteur pour les deux factures : même pseudonyme, la concentration ressort à l'audit.
  const runId = Date.now().toString(36);
  const financed: FinancedInvoice[] = [];
  for (const index of HISTORICAL_LOAN_INDEXES) {
    financed.push(await financeInvoice(client, actors, fund, buildDemoInvoice(HISTORICAL_DEBTOR, runId, index), index));
  }

  // Persisté une fois le fonds complet : une exécution interrompue laisse l'état précédent intact.
  const now = new Date().toISOString();
  store.reset(fund);
  store.update((state) => {
    state.deposited = true;
    for (const { issued, loan } of financed) {
      state.invoices.push({ tokenId: issued.tokenId, certificate: issued.certificate, issuedAt: now });
      state.loans.push({ ...loan, status: "active", createdAt: now });
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
