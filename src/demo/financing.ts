// Étapes partagées par les scénarios de démo : ouverture du fonds (comptes, Vault, souscription, KYB de la PME), puis
// financement d'une facture (preuve Groth16, certificat en Batch atomique, prêt).

import type { Client } from "xrpl";
import { ensureActors, type Actors } from "../accounts/actors.js";
import { FUND_VINTAGE, type CohortTiming, type FixedRedemptionTiming } from "../config/cohort.js";
import { loadNetworkConfig } from "../config/network.js";
import type { Fund } from "../fund/fund.js";
import { produceInvoiceCertificate, type InvoiceCertificate } from "../invoice/certificate.js";
import type { Invoice } from "../invoice/invoice.js";
import { issueCertificate, type IssuedCertificate } from "../invoice/issueCertificate.js";
import { onboardSme } from "../kyb/smeKyb.js";
import { originateLoan, type OriginatedLoan } from "../lending/loan.js";
import { loanTerms } from "../lending/loanTerms.js";
import { subscribe, type BariLiquidity } from "../lending/subscription.js";
import { log } from "../lib/logger.js";
import { setupFund } from "../setup/fundSetup.js";
import { fundStablecoin } from "../setup/stablecoin.js";
import { xrplLedger } from "../xrpl/ledger.js";
import { logTheoreticalEconomics } from "./economicsReport.js";

export interface OpenFund {
  actors: Actors;
  fund: Fund;
}

export interface FinancedInvoice {
  issued: IssuedCertificate;
  loan: OriginatedLoan;
}

/** Comptes, Vault fermé + LoanBroker, dépôts des investisseurs et first-loss (et liquidités de Bari), KYB de la PME. */
export async function openFund(
  client: Client,
  timing: CohortTiming | FixedRedemptionTiming,
  liquidity?: BariLiquidity,
): Promise<OpenFund> {
  const network = loadNetworkConfig();
  log.step(`Comptes (${network.genesisSeed === undefined ? `faucet ${network.faucetHost}` : "wallet genesis"})`);
  const actors = await ensureActors(client, network);

  log.step("Paramètres du prêt (IDEE §4)");
  logTheoreticalEconomics();

  const fund = await setupFund(client, actors, fundStablecoin(network, actors), timing, liquidity);

  log.step(`Souscription · dépôts des investisseurs + first-loss de Bari${liquidity === undefined ? "" : " + stock de parts de Bari"}`);
  await subscribe(client, actors, fund, liquidity);

  log.step("KYB de la PME · credential KYB_PME");
  await onboardSme(client, actors);
  return { actors, fund };
}

function certify(client: Client, actors: Actors, invoice: Invoice): Promise<InvoiceCertificate> {
  const networkId = client.networkID;
  if (networkId === undefined) throw new Error("NetworkID du nœud inconnu : impossible de lier la preuve à la chaîne");
  return produceInvoiceCertificate({
    invoice,
    smeAccount: actors.sme.address,
    registry: actors.bari_registry.address,
    networkId,
    vintage: FUND_VINTAGE,
    thresholdCents: loanTerms().provenThresholdCents,
  });
}

/** `undefined` si N est déjà enregistré (tecDUPLICATE) : rien n'est appliqué. */
export async function certifyAndIssue(
  client: Client,
  actors: Actors,
  invoice: Invoice,
): Promise<IssuedCertificate | undefined> {
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

export async function financeInvoice(
  client: Client,
  actors: Actors,
  fund: Fund,
  invoice: Invoice,
  index: number,
): Promise<FinancedInvoice> {
  log.step(`Facture ${index} · certificat (Batch atomique) : enregistrement de N + MPT facture avec preuve + remise à Bari`);
  const issued = await certifyAndIssue(client, actors, invoice);
  if (issued === undefined) throw new Error(`La première présentation de la facture ${index} devait réussir`);
  log.step(`Facture ${index} · prêt : contrôles de Bari, puis LoanSet co-signé`);
  const signers = { borrower: actors.sme, bari: actors.bari, kybIssuer: actors.kyb_issuer.address };
  return { issued, loan: await originateLoan(client, xrplLedger(client), signers, fund, issued) };
}
