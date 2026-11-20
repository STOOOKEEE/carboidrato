// Conditions d'un prêt Bari, en unités EURc, dérivées des paramètres de src/config/finance.ts.

import { ADVANCE_RATE_PERCENT, INVOICE_AMOUNT_EUR, ORIGINATION_FEE_PERCENT } from "../config/finance.js";
import { eurToUnits, percentOf } from "../lib/amounts.js";

export interface LoanTerms {
  invoice: bigint;
  /** Principal demandé (PrincipalRequested). */
  principal: bigint;
  /** Frais de dossier (LoanOriginationFee), déduits de l'avance versée. */
  originationFee: bigint;
  /** Ce que la PME reçoit réellement. */
  netAdvance: bigint;
}

/** Conditions pour une facture de `invoice` unités EURc (par défaut : la facture type de la démo). */
export function loanTerms(invoice: bigint = eurToUnits(INVOICE_AMOUNT_EUR)): LoanTerms {
  const principal = percentOf(invoice, ADVANCE_RATE_PERCENT);
  const originationFee = percentOf(principal, ORIGINATION_FEE_PERCENT);
  return { invoice, principal, originationFee, netAdvance: principal - originationFee };
}
