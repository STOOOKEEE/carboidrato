// Conditions d'un prêt Bari, en unités EURc, dérivées des paramètres de src/config/finance.ts, et son échéance.

import {
  LEDGER_LOAN_REDEMPTION_BUFFER_S,
  LEDGER_MIN_PAYMENT_INTERVAL_S,
  LEDGER_TIME_SAFETY_MARGIN_S,
} from "../config/cohort.js";
import { ADVANCE_RATE_PERCENT, INVOICE_AMOUNT_EUR, ORIGINATION_FEE_PERCENT } from "../config/finance.js";
import { eurToUnits, percentOf, unitsToCents } from "../lib/amounts.js";

export interface LoanTerms {
  invoice: bigint;
  /** Principal demandé (PrincipalRequested). */
  principal: bigint;
  /** Frais de dossier (LoanOriginationFee), déduits de l'avance versée. */
  originationFee: bigint;
  /** Ce que la PME reçoit réellement. */
  netAdvance: bigint;
  /** Seuil public de la preuve, en centimes : la facture vaut au moins ce montant, jamais révélé exactement. */
  provenThresholdCents: bigint;
}

/** Plus petit seuil en centimes tel que `principal ≤ taux d'avance × seuil`. */
export function provenThresholdCents(principalCents: bigint): bigint {
  const rate = BigInt(ADVANCE_RATE_PERCENT);
  const scaled = principalCents * 100n;
  return scaled / rate + (scaled % rate === 0n ? 0n : 1n);
}

/** Conditions pour une facture de `invoice` unités EURc (par défaut : la facture type de la démo). */
export function loanTerms(invoice: bigint = eurToUnits(INVOICE_AMOUNT_EUR)): LoanTerms {
  const principal = percentOf(invoice, ADVANCE_RATE_PERCENT);
  const originationFee = percentOf(principal, ORIGINATION_FEE_PERCENT);
  return {
    invoice,
    principal,
    originationFee,
    netAdvance: principal - originationFee,
    provenThresholdCents: provenThresholdCents(unitsToCents(principal)),
  };
}

/** Instants en temps Ripple (secondes) : heure du ledger, échéance prouvée de la facture, RedemptionDate du Vault. */
export interface MaturityInputs {
  now: number;
  invoiceDueDate: number;
  redemptionDate: number;
}

/**
 * PaymentInterval de l'unique échéance : le prêt tombe à l'échéance de la facture, sans dépasser le dernier instant
 * accepté par le ledger avant le rachat (60 s, plus l'écart possible avec l'heure du ledger qui inclura le LoanSet).
 */
export function loanPaymentInterval({ now, invoiceDueDate, redemptionDate }: MaturityInputs): number {
  if (invoiceDueDate <= now) throw new Error("Prêt refusé : échéance de la facture dépassée");
  const latestDueDate = redemptionDate - LEDGER_LOAN_REDEMPTION_BUFFER_S - LEDGER_TIME_SAFETY_MARGIN_S;
  const interval = Math.min(invoiceDueDate, latestDueDate) - now;
  if (interval < LEDGER_MIN_PAYMENT_INTERVAL_S) {
    throw new Error(
      `Prêt trop court (${interval} s < ${LEDGER_MIN_PAYMENT_INTERVAL_S} s) : échéance de la facture ou rachat du fonds trop proche`,
    );
  }
  return interval;
}
