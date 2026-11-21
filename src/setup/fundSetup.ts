// Mise en place du fonds : RLUSD, KYC des prêteurs, domaine, Vault fermé (fiche publique en Data), LoanBroker.

import { rippleTimeToISOTime, type Client } from "xrpl";
import { INVESTORS, type ActorName, type Actors } from "../accounts/actors.js";
import { FUND_VINTAGE, type CohortTiming, type FixedRedemptionTiming } from "../config/cohort.js";
import { DEMO_INVOICE_COUNT, INVESTOR_DEPOSITS_RLUSD } from "../config/finance.js";
import type { Fund } from "../fund/fund.js";
import type { FundManifest } from "../fund/fundManifest.js";
import { verifiedDebtorsRoot } from "../invoice/certificate.js";
import { CREDENTIAL_TYPES, ensureCredential } from "../kyb/kycCredentials.js";
import { bariFirstLossUnits } from "../lending/economics.js";
import { loanTerms } from "../lending/loanTerms.js";
import type { BariLiquidity } from "../lending/subscription.js";
import { rlusdToUnits } from "../lib/amounts.js";
import { log } from "../lib/logger.js";
import { xrplLedger } from "../xrpl/ledger.js";
import { currencyLabel, type Stablecoin } from "../xrpl/stablecoin.js";
import { createLenderDomain } from "./lenderDomain.js";
import { enableRippling, ensureTrustLine, issueStablecoin } from "./stablecoin.js";
import { createClosedVault, createLoanBroker } from "./vault.js";

const HOLDERS: readonly ActorName[] = ["investor_1", "investor_2", "bari", "mairie", "sme"];

/** Soldes visés : Bari reçoit sa first-loss, plus, pour le fonds durable, son stock de parts à souscrire et sa réserve. */
function targetBalances(liquidity?: BariLiquidity): ReadonlyArray<readonly [ActorName, bigint]> {
  const bariExtra = liquidity === undefined ? 0n : liquidity.shareStock + liquidity.reserve;
  return [
    ["investor_1", rlusdToUnits(INVESTOR_DEPOSITS_RLUSD.investor_1)],
    ["investor_2", rlusdToUnits(INVESTOR_DEPOSITS_RLUSD.investor_2)],
    ["bari", bariFirstLossUnits() + bariExtra],
    // La mairie paie les factures du scénario à l'échéance.
    ["mairie", loanTerms().invoice * BigInt(DEMO_INVOICE_COUNT)],
  ];
}

/**
 * Lignes de confiance des détenteurs, puis, avec l'émetteur de test de Bari, émission de ce qui manque à chacun : les
 * soldes restent d'un fonds à l'autre. Un émetteur externe (RLUSD_ISSUER) n'émet pas pour Bari.
 */
async function distributeStablecoin(client: Client, actors: Actors, asset: Stablecoin, liquidity?: BariLiquidity): Promise<void> {
  const issuer = actors.stable_issuer;
  const isTestIssuer = asset.issuer === issuer.address;
  if (isTestIssuer) await enableRippling(client, issuer);
  for (const holder of HOLDERS) {
    await ensureTrustLine(client, asset, actors[holder], holder);
  }
  if (!isTestIssuer) {
    log.warn(`émetteur RLUSD externe ${asset.issuer} : les soldes des détenteurs ne sont pas émis par Bari`);
    return;
  }
  const ledger = xrplLedger(client);
  for (const [name, target] of targetBalances(liquidity)) {
    const balance = await ledger.stablecoinBalance(asset, actors[name].address);
    if (balance < target) await issueStablecoin(client, asset, issuer, actors[name].address, target - balance, name);
  }
}

async function issueInvestorCredentials(client: Client, actors: Actors): Promise<void> {
  for (const name of INVESTORS) {
    await ensureCredential(client, {
      issuer: actors.kyb_issuer,
      subject: actors[name],
      subjectName: name,
      type: CREDENTIAL_TYPES.kycInvestor,
    });
  }
}

export async function setupFund(
  client: Client,
  actors: Actors,
  stablecoin: Stablecoin,
  timing: CohortTiming | FixedRedemptionTiming,
  liquidity?: BariLiquidity,
): Promise<Fund> {
  log.step(`Mise en place · ${currencyLabel(stablecoin.currency)} (émetteur ${stablecoin.issuer})`);
  await distributeStablecoin(client, actors, stablecoin, liquidity);

  log.step("Mise en place · KYC des investisseurs et domaine permissionné");
  await issueInvestorCredentials(client, actors);
  const domainId = await createLenderDomain(client, actors.bari, actors.kyb_issuer.address);

  log.step("Mise en place · Vault privé fermé (racine des débiteurs vérifiés en Data) + LoanBroker");
  const manifest: FundManifest = {
    debtorsRoot: await verifiedDebtorsRoot(),
    vintage: FUND_VINTAGE,
    registry: actors.bari_registry.address,
  };
  const cohort = await createClosedVault(client, actors.bari, stablecoin, domainId, timing, manifest);
  log.info(`Vault ${cohort.vaultId}`);
  log.info(`Data : racine ${manifest.debtorsRoot}, millésime ${manifest.vintage}, registre ${manifest.registry}`);
  log.info(`souscription jusqu'à ${rippleTimeToISOTime(cohort.subscriptionDate)}, rachat dès ${rippleTimeToISOTime(cohort.redemptionDate)}`);
  const brokerId = await createLoanBroker(client, actors.bari, cohort.vaultId);
  log.info(`LoanBroker ${brokerId}`);
  return { stablecoin, domainId, cohort, brokerId, manifest };
}
