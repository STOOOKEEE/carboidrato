// Mise en place du fonds : stablecoin, KYC des prêteurs, domaine, Vault fermé (fiche publique en Data), LoanBroker.

import { rippleTimeToISOTime, type Client } from "xrpl";
import { INVESTORS, type ActorName, type Actors } from "../accounts/actors.js";
import { FUND_VINTAGE, type CohortTiming, type FixedRedemptionTiming } from "../config/cohort.js";
import { DEMO_INVOICE_COUNT, INVESTOR_DEPOSITS_EUR } from "../config/finance.js";
import type { Fund } from "../fund/fund.js";
import type { FundManifest } from "../fund/fundManifest.js";
import { verifiedDebtorsRoot } from "../invoice/certificate.js";
import { CREDENTIAL_TYPES, ensureCredential } from "../kyb/kycCredentials.js";
import { bariFirstLossUnits } from "../lending/economics.js";
import { loanTerms } from "../lending/loanTerms.js";
import type { BariLiquidity } from "../lending/subscription.js";
import { eurToUnits, formatEur } from "../lib/amounts.js";
import { log } from "../lib/logger.js";
import { authorizeMpt, sendMpt } from "../xrpl/mpt.js";
import { createLenderDomain } from "./lenderDomain.js";
import { createStablecoin } from "./stablecoin.js";
import { createClosedVault, createLoanBroker } from "./vault.js";

const HOLDERS: readonly ActorName[] = ["investor_1", "investor_2", "bari", "mairie", "sme"];

/** Bari reçoit sa first-loss, plus, pour le fonds durable, son stock de parts à souscrire et sa réserve EURc. */
function initialBalances(liquidity?: BariLiquidity): ReadonlyArray<readonly [ActorName, bigint]> {
  const bariExtra = liquidity === undefined ? 0n : liquidity.shareStock + liquidity.reserve;
  return [
    ["investor_1", eurToUnits(INVESTOR_DEPOSITS_EUR.investor_1)],
    ["investor_2", eurToUnits(INVESTOR_DEPOSITS_EUR.investor_2)],
    ["bari", bariFirstLossUnits() + bariExtra],
    // La mairie paie les factures du scénario à l'échéance.
    ["mairie", loanTerms().invoice * BigInt(DEMO_INVOICE_COUNT)],
  ];
}

async function distributeStablecoin(
  client: Client,
  actors: Actors,
  assetId: string,
  liquidity?: BariLiquidity,
): Promise<void> {
  for (const holder of HOLDERS) {
    await authorizeMpt(client, assetId, actors[holder], holder);
  }
  for (const [name, units] of initialBalances(liquidity)) {
    await sendMpt(client, assetId, actors.stable_issuer, actors[name].address, units, `Payment EURc → ${name} (${formatEur(units, 2)})`);
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
  timing: CohortTiming | FixedRedemptionTiming,
  liquidity?: BariLiquidity,
): Promise<Fund> {
  log.step("Mise en place · stablecoin EURc");
  const assetId = await createStablecoin(client, actors.stable_issuer);
  log.info(`EURc : ${assetId}`);
  await distributeStablecoin(client, actors, assetId, liquidity);

  log.step("Mise en place · KYC des investisseurs et domaine permissionné");
  await issueInvestorCredentials(client, actors);
  const domainId = await createLenderDomain(client, actors.bari, actors.kyb_issuer.address);

  log.step("Mise en place · Vault privé fermé (racine des débiteurs vérifiés en Data) + LoanBroker");
  const manifest: FundManifest = {
    debtorsRoot: await verifiedDebtorsRoot(),
    vintage: FUND_VINTAGE,
    registry: actors.bari_registry.address,
  };
  const cohort = await createClosedVault(client, actors.bari, assetId, domainId, timing, manifest);
  log.info(`Vault ${cohort.vaultId}`);
  log.info(`Data : racine ${manifest.debtorsRoot}, millésime ${manifest.vintage}, registre ${manifest.registry}`);
  log.info(`souscription jusqu'à ${rippleTimeToISOTime(cohort.subscriptionDate)}, rachat dès ${rippleTimeToISOTime(cohort.redemptionDate)}`);
  const brokerId = await createLoanBroker(client, actors.bari, cohort.vaultId);
  log.info(`LoanBroker ${brokerId}`);
  return { assetId, domainId, cohort, brokerId, manifest };
}
