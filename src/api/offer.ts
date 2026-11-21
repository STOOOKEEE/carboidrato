// Barème public du fonds : pour chaque palier, l'avance (src/config/finance.ts), les frais et le coût sur la durée réelle
// du prêt. Le montant exact de la facture n'y entre pas : le navigateur de la PME y lit l'offre de son palier.

import { ADVANCE_RATE_PERCENT, INTEREST_RATE_PERCENT, ORIGINATION_FEE_PERCENT } from "../config/finance.js";
import { theoreticalLoanEconomics } from "../lending/economics.js";
import { loanTerms, OFFER_TIERS_USD } from "../lending/loanTerms.js";
import { CENTS_PER_USD, usdToUnits, unitsToUsd } from "../lib/amounts.js";
import type { LoanOffer, OfferSchedule } from "./contract.js";

const SECONDS_PER_DAY = 86_400;
const MS_PER_SECOND = 1_000;

/** Jours entiers restant jusqu'à l'échéance (0 si elle est passée). */
export function daysUntil(dueDateSeconds: number, nowSeconds: number): number {
  return Math.max(0, Math.ceil((dueDateSeconds - nowSeconds) / SECONDS_PER_DAY));
}

function tierOffer(tier: bigint, termDays: number): LoanOffer {
  const terms = loanTerms(tier);
  const economics = theoreticalLoanEconomics(tier, termDays);
  return {
    provenThresholdUsd: Number(terms.provenThresholdCents) / CENTS_PER_USD,
    advanceRatePercent: ADVANCE_RATE_PERCENT,
    principalUsd: unitsToUsd(terms.principal),
    feeUsd: unitsToUsd(terms.originationFee),
    netAdvanceUsd: unitsToUsd(terms.netAdvance),
    interestUsd: unitsToUsd(economics.interest),
    interestRatePercent: INTEREST_RATE_PERCENT,
    totalCostUsd: unitsToUsd(economics.smeCost),
    annualCostPercent: economics.smeAnnualCostPercent,
    termDays,
    repaymentUsd: unitsToUsd(terms.principal + economics.interest),
  };
}

/** Secondes Unix : échéance de la facture, maintenant, et dernière échéance permise par le rachat du fonds s'il existe. */
export interface OfferTiming {
  dueDate: number;
  now: number;
  latestMaturity?: number;
}

/** Barème pour une facture payable à `dueDate` ; undefined si le prêt ne peut plus courir un jour entier. */
export function fundOffer({ dueDate, now, latestMaturity = Number.POSITIVE_INFINITY }: OfferTiming): OfferSchedule | undefined {
  const loanDueDate = Math.min(dueDate, latestMaturity);
  const termDays = daysUntil(loanDueDate, now);
  if (termDays === 0) return undefined;
  return {
    advanceRatePercent: ADVANCE_RATE_PERCENT,
    feeRatePercent: ORIGINATION_FEE_PERCENT,
    interestRatePercent: INTEREST_RATE_PERCENT,
    termDays,
    loanDueDate: new Date(loanDueDate * MS_PER_SECOND).toISOString(),
    tiers: OFFER_TIERS_USD.map((usd) => tierOffer(usdToUnits(usd), termDays)),
  };
}
