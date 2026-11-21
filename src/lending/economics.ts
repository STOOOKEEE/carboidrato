// Chiffres théoriques d'un prêt sur la vraie durée de la facture (90 jours), affichés à côté de la démo
// dont la durée est compressée. Montants arrondis au centime : intérêts au centime supérieur (comme un dû).

import {
  COVER_RATE_MINIMUM_PERCENT,
  DEMO_INVOICE_COUNT,
  INTEREST_RATE_PERCENT,
  INVOICE_TERM_DAYS,
  MANAGEMENT_FEE_RATE_PERCENT,
  STABLECOIN_ASSET_SCALE,
} from "../config/finance.js";
import { percentOf, ratioPercent } from "../lib/amounts.js";
import { loanTerms } from "./loanTerms.js";

const DAYS_PER_YEAR = 365n;
const CENT_DECIMALS = 2;
const UNITS_PER_CENT = 10n ** BigInt(STABLECOIN_ASSET_SCALE - CENT_DECIMALS);

export interface LoanEconomics {
  principal: bigint;
  originationFee: bigint;
  netAdvance: bigint;
  interest: bigint;
  /** Frais de dossier + intérêts. */
  smeCost: bigint;
  /** Coût annualisé rapporté à l'avance nette, en %. */
  smeAnnualCostPercent: number;
  /** Frais de dossier + ManagementFeeRate des intérêts. */
  bariRevenue: bigint;
  investorsInterest: bigint;
  investorsAnnualYieldPercent: number;
}

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
const roundUpToCent = (units: bigint) => ceilDiv(units, UNITS_PER_CENT) * UNITS_PER_CENT;
const roundToCent = (units: bigint) => ((units + UNITS_PER_CENT / 2n) / UNITS_PER_CENT) * UNITS_PER_CENT;

/** Rendement sur `termDays` jours, ramené à l'année (intérêts simples). */
function annualize(gain: bigint, capital: bigint, termDays: number): number {
  return (ratioPercent(gain, capital) * Number(DAYS_PER_YEAR)) / termDays;
}

/** Chiffres d'un prêt sur une facture de `invoice` unités d'euro à `termDays` jours (défaut : facture type, 90 jours) ; montants en unités RLUSD. */
export function theoreticalLoanEconomics(invoice?: bigint, termDays: number = INVOICE_TERM_DAYS): LoanEconomics {
  if (!Number.isInteger(termDays) || termDays <= 0) throw new Error(`Durée invalide : ${termDays} jours`);
  const { principal, originationFee, netAdvance } = loanTerms(invoice);
  const interestOverTerm = percentOf(principal * BigInt(termDays), INTEREST_RATE_PERCENT, "up");
  const interest = roundUpToCent(ceilDiv(interestOverTerm, DAYS_PER_YEAR));
  const managementFee = roundToCent(percentOf(interest, MANAGEMENT_FEE_RATE_PERCENT));
  const smeCost = originationFee + interest;
  const investorsInterest = interest - managementFee;
  return {
    principal,
    originationFee,
    netAdvance,
    interest,
    smeCost,
    smeAnnualCostPercent: annualize(smeCost, netAdvance, termDays),
    bariRevenue: originationFee + managementFee,
    investorsInterest,
    investorsAnnualYieldPercent: annualize(investorsInterest, principal, termDays),
  };
}

/**
 * Mise en première perte de Bari : 10 % de l'encours maximal du millésime, soit les prêts prévus
 * avec leurs intérêts théoriques sur toute la durée de la facture (le ledger vérifie CoverRateMinimum
 * sur la dette, principal et intérêts compris).
 */
export function bariFirstLossUnits(): bigint {
  const { principal, interest } = theoreticalLoanEconomics();
  const maxOutstanding = (principal + interest) * BigInt(DEMO_INVOICE_COUNT);
  return percentOf(maxOutstanding, COVER_RATE_MINIMUM_PERCENT, "up");
}
