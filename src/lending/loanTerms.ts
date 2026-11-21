// Conditions d'un prêt Bari par palier public, dérivées des paramètres de src/config/finance.ts, et son échéance. Palier en
// unités de dollar, principal et frais en unités RLUSD : 1 $ de palier vaut 1 RLUSD (sans oracle de prix).

import {
  LEDGER_LOAN_REDEMPTION_BUFFER_S,
  LEDGER_MIN_PAYMENT_INTERVAL_S,
  LEDGER_TIME_SAFETY_MARGIN_S,
} from "../config/cohort.js";
import { ADVANCE_RATE_PERCENT, INVOICE_AMOUNT_USD, ORIGINATION_FEE_PERCENT } from "../config/finance.js";
import { usdToCents, usdToUnits, formatUsd, percentOf, unitsToCents } from "../lib/amounts.js";

/** Seuils publics de l'offre, croissants : seul le palier d'une facture devient public, jamais son montant. */
export const OFFER_TIERS_USD = [5_000, 10_000, 20_000, 50_000, 100_000] as const;

const OFFER_TIERS = OFFER_TIERS_USD.map(usdToUnits);
/** Les mêmes seuils en centimes, unité du seuil prouvé (`GET /api/proof/params`). */
export const OFFER_TIER_CENTS = OFFER_TIERS_USD.map(usdToCents);

export interface LoanTerms {
  /** Palier prouvé, en unités de dollar : la facture vaut au moins ce montant (la facture type de la démo vaut exactement son palier). */
  invoice: bigint;
  /** Principal demandé (PrincipalRequested), en unités RLUSD : le taux d'avance appliqué au palier. */
  principal: bigint;
  /** Frais de dossier (LoanOriginationFee), déduits de l'avance versée. */
  originationFee: bigint;
  /** Ce que la PME reçoit réellement. */
  netAdvance: bigint;
  /** Seuil public de la preuve, en centimes : le palier. */
  provenThresholdCents: bigint;
}

/** Palier d'un montant en unités de dollar : le plus grand seuil public qui ne le dépasse pas, undefined sous le premier. */
export function offerTier(amount: bigint): bigint | undefined {
  return OFFER_TIERS.filter((tier) => tier <= amount).at(-1);
}

/** Un seuil prouvé (centimes) n'est accepté que s'il est un palier public : un autre seuil en dirait plus sur la facture. */
export function isOfferTier(thresholdCents: bigint): boolean {
  return OFFER_TIER_CENTS.includes(thresholdCents);
}

/** Seuil à prouver pour une facture de `amountCents` : son palier en centimes, undefined sous le premier palier. */
export function provenThresholdCents(amountCents: bigint): bigint | undefined {
  return OFFER_TIER_CENTS.filter((tier) => tier <= amountCents).at(-1);
}

/** Conditions adossées au palier de `amount` unités de dollar garanties par la preuve (par défaut : la facture type). */
export function loanTerms(amount: bigint = usdToUnits(INVOICE_AMOUNT_USD)): LoanTerms {
  const tier = offerTier(amount);
  if (tier === undefined) throw new Error(`Aucune offre sous le premier palier (${formatUsd(OFFER_TIERS[0], 0)}) : ${formatUsd(amount, 2)}`);
  const principal = percentOf(tier, ADVANCE_RATE_PERCENT);
  const originationFee = percentOf(principal, ORIGINATION_FEE_PERCENT);
  return {
    invoice: tier,
    principal,
    originationFee,
    netAdvance: principal - originationFee,
    provenThresholdCents: unitsToCents(tier),
  };
}

/** Instants en temps Ripple (secondes) : heure du ledger, échéance prouvée de la facture, RedemptionDate du Vault. */
export interface MaturityInputs {
  now: number;
  invoiceDueDate: number;
  redemptionDate: number;
}

/**
 * Dernière échéance acceptée par le ledger avant le rachat : 60 s avant, moins l'écart possible avec l'heure du
 * ledger qui inclura le LoanSet.
 */
export function latestLoanMaturity(redemptionDate: number): number {
  return redemptionDate - LEDGER_LOAN_REDEMPTION_BUFFER_S - LEDGER_TIME_SAFETY_MARGIN_S;
}

function boundedInterval({ now, invoiceDueDate, redemptionDate }: MaturityInputs): number {
  return Math.min(invoiceDueDate, latestLoanMaturity(redemptionDate)) - now;
}

/** Raison du refus de l'échéance (message public), undefined si le prêt peut tomber à l'échéance bornée. */
export function maturityProblem(inputs: MaturityInputs): string | undefined {
  if (inputs.invoiceDueDate <= inputs.now) return "The invoice due date has passed";
  const interval = boundedInterval(inputs);
  if (interval < LEDGER_MIN_PAYMENT_INTERVAL_S) {
    return `Loan too short (${interval} s < ${LEDGER_MIN_PAYMENT_INTERVAL_S} s): the invoice due date or the fund redemption is too close`;
  }
  return undefined;
}

/** PaymentInterval de l'unique échéance : le prêt tombe à l'échéance de la facture, sans dépasser le rachat. */
export function loanPaymentInterval(inputs: MaturityInputs): number {
  const problem = maturityProblem(inputs);
  if (problem !== undefined) throw new Error(problem);
  return boundedInterval(inputs);
}
