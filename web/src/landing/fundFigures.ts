// Chiffres clés du fonds pour la landing, lus de `GET /api/fund` (montants en unités EURc, 6 décimales).

import { formatDate } from "../format";

/** Champs de `GET /api/fund` lus par le front. */
export interface FundSnapshot {
  redemptionStartsAt: string;
  vault: { assetsTotal: string };
  loans: unknown[];
}

export interface FundFigure {
  value: string;
  label: string;
}

const EURC_UNITS_PER_EUR = 1_000_000n;
const wholeEur = new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

export function fundFigures(fund: FundSnapshot): FundFigure[] {
  return [
    { value: wholeEur.format(Number(BigInt(fund.vault.assetsTotal) / EURC_UNITS_PER_EUR)), label: "in the fund" },
    { value: String(fund.loans.length), label: "invoices financed" },
    { value: formatDate(fund.redemptionStartsAt), label: "lending until" },
  ];
}
