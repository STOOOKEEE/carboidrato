// Offre de prêt pour une facture attestée : mêmes règles que les prêts on-chain (src/config/finance.ts),
// sur la durée réelle restant jusqu'à l'échéance.

import { ADVANCE_RATE_PERCENT, INTEREST_RATE_PERCENT } from "../config/finance.js";
import { theoreticalLoanEconomics } from "../lending/economics.js";
import { loanTerms } from "../lending/loanTerms.js";
import { centsToUnits, unitsToEur } from "../lib/amounts.js";
import type { LoanOffer } from "./contract.js";

const SECONDS_PER_DAY = 86_400;

/** Jours entiers restant jusqu'à l'échéance (0 si elle est passée). */
export function daysUntil(dueDateSeconds: number, nowSeconds: number): number {
  return Math.max(0, Math.ceil((dueDateSeconds - nowSeconds) / SECONDS_PER_DAY));
}

export function buildOffer(amountCents: number, termDays: number): LoanOffer {
  const invoice = centsToUnits(amountCents);
  const terms = loanTerms(invoice);
  const economics = theoreticalLoanEconomics(invoice, termDays);
  return {
    invoiceEur: unitsToEur(invoice),
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
