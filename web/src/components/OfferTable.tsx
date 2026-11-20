import type { LoanOffer } from "../../../src/api/contract";
import { formatDate, formatEur, formatPercent } from "../format";

export function OfferTable({ offer, dueDate }: { offer: LoanOffer; dueDate: string }) {
  const rows: [string, string][] = [
    ["Invoice amount", formatEur(offer.invoiceEur)],
    [`Advance (${formatPercent(offer.advanceRatePercent)})`, formatEur(offer.principalEur)],
    ["Processing fee", `− ${formatEur(offer.feeEur)}`],
    [`Interest (${formatPercent(offer.interestRatePercent)}/yr · ${offer.termDays} days)`, formatEur(offer.interestEur)],
    [`You repay on ${formatDate(dueDate)}`, formatEur(offer.repaymentEur)],
    ["Total cost", `${formatEur(offer.totalCostEur)} · ≈ ${formatPercent(offer.annualCostPercent)}/yr`],
  ];
  return (
    <dl className="offer-table">
      {rows.map(([label, value]) => (
        <div key={label} className="offer-row">
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
