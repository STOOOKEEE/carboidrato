// Offre de prêt du fonds : avance fixe (src/config/finance.ts) adossée au seuil prouvé, sur la durée réelle restant
// jusqu'à l'échéance. Le montant exact de la facture n'y entre pas : il reste dans le navigateur de la PME.

import { ADVANCE_RATE_PERCENT, INTEREST_RATE_PERCENT } from "../config/finance.js";
import { theoreticalLoanEconomics } from "../lending/economics.js";
import { loanTerms } from "../lending/loanTerms.js";
import { CENTS_PER_EUR, unitsToEur } from "../lib/amounts.js";
import type { LoanOffer } from "./contract.js";

const SECONDS_PER_DAY = 86_400;

/** Jours entiers restant jusqu'à l'échéance (0 si elle est passée). */
export function daysUntil(dueDateSeconds: number, nowSeconds: number): number {
  return Math.max(0, Math.ceil((dueDateSeconds - nowSeconds) / SECONDS_PER_DAY));
}

export function fundOffer(termDays: number): LoanOffer {
  const terms = loanTerms();
  const economics = theoreticalLoanEconomics(undefined, termDays);
  return {
    provenThresholdEur: Number(terms.provenThresholdCents) / CENTS_PER_EUR,
    advanceRatePercent: ADVANCE_RATE_PERCENT,
    principalEur: unitsToEur(terms.principal),
    feeEur: unitsToEur(terms.originationFee),
    netAdvanceEur: unitsToEur(terms.netAdvance),
    interestEur: unitsToEur(economics.interest),
    interestRatePercent: INTEREST_RATE_PERCENT,
    totalCostEur: unitsToEur(economics.smeCost),
    annualCostPercent: economics.smeAnnualCostPercent,
    termDays,
    repaymentEur: unitsToEur(terms.principal + economics.interest),
  };
}
