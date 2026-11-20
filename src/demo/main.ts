// Scénario de démo Bari (IDEE §5 et §9) : certificat en Batch atomique, prêt à part. `--default` : la PME ne rembourse pas.

import { Client } from "xrpl";
import { auditFund } from "../audit/auditFund.js";
import { loadCohortTiming } from "../config/cohort.js";
import { loadNetworkConfig } from "../config/network.js";
import { DEMO_DEBTOR } from "../invoice/debtors.js";
import { buildDemoInvoice } from "../invoice/invoice.js";
import { defaultLoan } from "../lending/defaultFlow.js";
import type { OriginatedLoan } from "../lending/loan.js";
import { redeemAll } from "../lending/redemption.js";
import { repayLoan } from "../lending/repayment.js";
import { log } from "../lib/logger.js";
import { certifyAndIssue, financeInvoice, openFund } from "./financing.js";
import { releaseZkResources } from "../zk/index.js";

const DEFAULT_SCENARIO_FLAG = "--default";

async function run(client: Client, defaultScenario: boolean): Promise<void> {
  const { actors, fund } = await openFund(client, loadCohortTiming());

  const runId = Date.now().toString(36);
  const [firstInvoice, secondInvoice] = [1, 2].map((index) => buildDemoInvoice(DEMO_DEBTOR, runId, index));
  const loans: OriginatedLoan[] = [(await financeInvoice(client, actors, fund, firstInvoice, 1)).loan];

  log.step("Facture 1 · nouvelle attestation de la même facture (tentative de refinancement)");
  if ((await certifyAndIssue(client, actors, firstInvoice)) !== undefined) {
    throw new Error("Le rejeu aurait dû être bloqué par tecDUPLICATE");
  }

  loans.push((await financeInvoice(client, actors, fund, secondInvoice, 2)).loan);
  log.info(`même débiteur, même millésime → même pseudonyme : ${loans[0].reference.pseudonym === loans[1].reference.pseudonym ? "oui" : "NON"}`);

  log.step("Audit du fonds depuis le ledger (preuves, unicité, concentration)");
  await auditFund(client, fund.cohort.vaultId);

  for (const [index, loan] of loans.entries()) {
    if (defaultScenario) {
      log.step(`Défaut du prêt ${index + 1} · impairment puis défaut, la first-loss de Bari absorbe`);
      await defaultLoan(client, actors, fund, loan.loanId);
    } else {
      log.step(`Remboursement du prêt ${index + 1} · mairie → PME, LoanPay, retour du MPT facture`);
      await repayLoan(client, actors, fund, loan);
    }
  }

  log.step("Rachat · VaultWithdraw des investisseurs");
  await redeemAll(client, actors, fund);

  log.step(`Terminé en ${log.elapsedSeconds()} s (${defaultScenario ? "scénario défaut" : "scénario nominal"})`);
  log.info(`audit public : npm run audit -- ${fund.cohort.vaultId}`);
}

async function main(): Promise<void> {
  const client = new Client(loadNetworkConfig().wsUrl);
  await client.connect();
  try {
    await run(client, process.argv.includes(DEFAULT_SCENARIO_FLAG));
  } finally {
    await client.disconnect();
    await releaseZkResources();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
