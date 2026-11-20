// Scénario de démo Bari (IDEE §5 et §9) : certificat en Batch atomique, prêt à part. `--default` : la PME ne rembourse pas.

import { Client } from "xrpl";
import { ensureActors, type Actors } from "../accounts/actors.js";
import { auditFund } from "../audit/auditFund.js";
import { FUND_VINTAGE, loadCohortTiming } from "../config/cohort.js";
import { INVOICE_AMOUNT_EUR } from "../config/finance.js";
import { loadNetworkConfig } from "../config/network.js";
import { produceInvoiceCertificate, type InvoiceCertificate } from "../invoice/certificate.js";
import { DEMO_DEBTOR } from "../invoice/debtors.js";
import { buildDemoInvoice, type Invoice } from "../invoice/invoice.js";
import { issueCertificate, type IssuedCertificate } from "../invoice/issueCertificate.js";
import { onboardSme } from "../kyb/smeKyb.js";
import { defaultLoan } from "../lending/defaultFlow.js";
import { originateLoan, type OriginatedLoan } from "../lending/loan.js";
import { redeemAll } from "../lending/redemption.js";
import { repayLoan } from "../lending/repayment.js";
import { subscribe } from "../lending/subscription.js";
import { log } from "../lib/logger.js";
import { setupFund, type Fund } from "../setup/fundSetup.js";
import { logTheoreticalEconomics } from "./economicsReport.js";
import { releaseZkResources } from "../zk/index.js";

const DEFAULT_SCENARIO_FLAG = "--default";

function certify(client: Client, actors: Actors, invoice: Invoice): Promise<InvoiceCertificate> {
  const networkId = client.networkID;
  if (networkId === undefined) throw new Error("NetworkID du nœud inconnu : impossible de lier la preuve à la chaîne");
  return produceInvoiceCertificate({
    invoice,
    smeAccount: actors.sme.address,
    registry: actors.bari_registry.address,
    networkId,
    vintage: FUND_VINTAGE,
    thresholdEur: INVOICE_AMOUNT_EUR,
  });
}

async function certifyAndIssue(client: Client, actors: Actors, invoice: Invoice): Promise<IssuedCertificate | undefined> {
  log.info(`la mairie atteste la facture ${invoice.number} (EdDSA) ; la PME calcule la preuve Groth16`);
  const startedAt = performance.now();
  const certificate = await certify(client, actors, invoice);
  log.info(`preuve calculée en ${Math.round(performance.now() - startedAt)} ms`);
  return issueCertificate(
    client,
    { sme: actors.sme, bari: actors.bari, registry: actors.bari_registry.address },
    certificate,
  );
}

async function financeInvoice(
  client: Client,
  actors: Actors,
  fund: Fund,
  invoice: Invoice,
  index: number,
): Promise<OriginatedLoan> {
  log.step(`Facture ${index} · certificat (Batch atomique) : enregistrement de N + MPT facture avec preuve + remise à Bari`);
  const issued = await certifyAndIssue(client, actors, invoice);
  if (issued === undefined) throw new Error(`La première présentation de la facture ${index} devait réussir`);
  log.step(`Facture ${index} · prêt : contrôles de Bari, puis LoanSet co-signé`);
  return originateLoan(client, actors, fund, issued);
}

async function run(client: Client, defaultScenario: boolean): Promise<void> {
  const network = loadNetworkConfig();
  log.step(`Comptes (${network.genesisSeed === undefined ? `faucet ${network.faucetHost}` : "wallet genesis"})`);
  const actors = await ensureActors(client, network);

  log.step("Paramètres du prêt (IDEE §4)");
  logTheoreticalEconomics();

  const fund = await setupFund(client, actors, loadCohortTiming());

  log.step("Souscription · dépôts des investisseurs + first-loss de Bari");
  await subscribe(client, actors, fund);

  log.step("KYB de la PME · credential KYB_PME");
  await onboardSme(client, actors);

  const runId = Date.now().toString(36);
  const [firstInvoice, secondInvoice] = [1, 2].map((index) => buildDemoInvoice(DEMO_DEBTOR, runId, index));
  const loans: OriginatedLoan[] = [await financeInvoice(client, actors, fund, firstInvoice, 1)];

  log.step("Facture 1 · nouvelle attestation de la même facture (tentative de refinancement)");
  if ((await certifyAndIssue(client, actors, firstInvoice)) !== undefined) {
    throw new Error("Le rejeu aurait dû être bloqué par tecDUPLICATE");
  }

  loans.push(await financeInvoice(client, actors, fund, secondInvoice, 2));
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
