// Affichage des chiffres théoriques d'un prêt sur 90 jours (la démo, elle, compresse la durée).

import {
  INTEREST_RATE_PERCENT,
  INVOICE_TERM_DAYS,
  MANAGEMENT_FEE_RATE_PERCENT,
  ORIGINATION_FEE_PERCENT,
} from "../config/finance.js";
import { theoreticalLoanEconomics } from "../lending/economics.js";
import { loanTerms } from "../lending/loanTerms.js";
import { formatUsd, formatPercent, formatRlusd } from "../lib/amounts.js";
import { log } from "../lib/logger.js";

const CENTS = 2;

export function logTheoreticalEconomics(): void {
  const terms = loanTerms();
  const theory = theoreticalLoanEconomics();
  log.info(
    `facture ${formatUsd(terms.invoice, CENTS)} · principal ${formatRlusd(terms.principal, CENTS)} · frais de dossier ${formatPercent(ORIGINATION_FEE_PERCENT)} = ${formatRlusd(terms.originationFee, CENTS)} · la PME reçoit ${formatRlusd(terms.netAdvance, CENTS)}`,
  );
  log.info(`taux ${formatPercent(INTEREST_RATE_PERCENT)}/an · Bari prend ${formatPercent(MANAGEMENT_FEE_RATE_PERCENT)} des intérêts`);
  log.info(`théorique sur ${INVOICE_TERM_DAYS} jours :`);
  log.info(`  intérêts                ${formatRlusd(theory.interest, CENTS)}`);
  log.info(
    `  coût pour la PME        ${formatRlusd(theory.smeCost, CENTS)} (≈ ${formatPercent(theory.smeAnnualCostPercent)}/an sur l'avance nette)`,
  );
  log.info(
    `  revenu des investisseurs ${formatRlusd(theory.investorsInterest, CENTS)} (≈ ${formatPercent(theory.investorsAnnualYieldPercent)}/an)`,
  );
  log.info(`  revenu de Bari          ${formatRlusd(theory.bariRevenue, CENTS)} (frais de dossier + part des intérêts)`);
}
