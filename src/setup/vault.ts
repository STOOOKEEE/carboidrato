// Vault privé fermé (XLS-65, un millésime de factures) et LoanBroker (XLS-66) de Bari.

import { VaultCreateFlags, VaultKind, type Client, type Wallet } from "xrpl";
import type { CohortTiming, FixedRedemptionTiming } from "../config/cohort.js";
import {
  COVER_RATE_LIQUIDATION_PERCENT,
  COVER_RATE_MINIMUM_PERCENT,
  MANAGEMENT_FEE_RATE_PERCENT,
  STABLECOIN_ASSET_SCALE,
} from "../config/finance.js";
import type { Cohort } from "../fund/fund.js";
import { encodeFundManifest, type FundManifest } from "../fund/fundManifest.js";
import { percentToTenthBips } from "../lib/rates.js";
import { getVault } from "../xrpl/ledgerEntries.js";
import { ledgerTime } from "../xrpl/ledgerTime.js";
import { createdLedgerIndex } from "../xrpl/meta.js";
import type { Stablecoin } from "../xrpl/stablecoin.js";
import { submitTx } from "../xrpl/submit.js";

export async function createClosedVault(
  client: Client,
  bari: Wallet,
  asset: Stablecoin,
  domainId: string,
  timing: CohortTiming | FixedRedemptionTiming,
  manifest: FundManifest,
): Promise<Cohort> {
  const subscriptionDate = (await ledgerTime(client)) + timing.subscriptionWindowS;
  const redemptionDate =
    "redemptionDate" in timing ? timing.redemptionDate : subscriptionDate + timing.investmentPeriodS;
  const outcome = await submitTx(
    client,
    {
      TransactionType: "VaultCreate",
      Account: bari.address,
      Asset: { currency: asset.currency, issuer: asset.issuer },
      // Une part par unité de 10^-6 RLUSD au pair, comme les montants internes de Bari.
      Scale: STABLECOIN_ASSET_SCALE,
      Flags: VaultCreateFlags.tfVaultPrivate,
      DomainID: domainId,
      VaultKind: VaultKind.vaultKindClosed,
      SubscriptionDate: subscriptionDate,
      RedemptionDate: redemptionDate,
      Data: encodeFundManifest(manifest),
    },
    bari,
    "VaultCreate (privé, fermé)",
  );
  const vaultId = createdLedgerIndex(outcome.meta, "Vault");
  const vault = await getVault(client, vaultId);
  return { vaultId, shareMptId: vault.ShareMPTID, subscriptionDate, redemptionDate };
}

export async function createLoanBroker(client: Client, bari: Wallet, vaultId: string): Promise<string> {
  const outcome = await submitTx(
    client,
    {
      TransactionType: "LoanBrokerSet",
      Account: bari.address,
      VaultID: vaultId,
      ManagementFeeRate: percentToTenthBips(MANAGEMENT_FEE_RATE_PERCENT),
      CoverRateMinimum: percentToTenthBips(COVER_RATE_MINIMUM_PERCENT),
      CoverRateLiquidation: percentToTenthBips(COVER_RATE_LIQUIDATION_PERCENT),
    },
    bari,
    "LoanBrokerSet",
  );
  return createdLedgerIndex(outcome.meta, "LoanBroker");
}
