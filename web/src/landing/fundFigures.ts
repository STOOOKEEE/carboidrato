// Chiffres clés du fonds pour la landing, lus de `GET /api/fund` (montants en unités RLUSD, 6 décimales).

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

const RLUSD_UNITS = 1_000_000n;
const wholeRlusd = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });

export function fundFigures(fund: FundSnapshot): FundFigure[] {
  return [
    { value: `${wholeRlusd.format(Number(BigInt(fund.vault.assetsTotal) / RLUSD_UNITS))} RLUSD`, label: "in the fund" },
    { value: String(fund.loans.length), label: "invoices financed" },
    { value: formatDate(fund.redemptionStartsAt), label: "lending until" },
  ];
}
