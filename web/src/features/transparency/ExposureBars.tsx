// Exposition par débiteur : une barre par pseudonyme P, pleine au plafond de concentration du fonds.
import type { FundAudit } from "../../../../src/api/contract";
import { formatPercent } from "../../format";
import { exposures } from "./transparency";

export function ExposureBars({ audit }: { audit: FundAudit }) {
  const limit = formatPercent(audit.concentrationLimitPercent);
  return (
    <section className="step" data-testid="transparency-exposure">
      <h2>Exposure per debtor</h2>
      <p className="muted">
        Each debtor shows up under an alias that only this fund uses: nobody learns who it is, everyone can add up what it owes.
        A full bar is the limit of {limit} of the fund on one debtor.
      </p>
      <ul className="exposures">
        {exposures(audit).map((row) => (
          <li key={row.pseudonym} className={row.breach ? "exposure breach" : "exposure"}>
            <span className="mono" title={row.pseudonym}>
              {row.alias}
            </span>
            <span
              className="exposure-track"
              role="meter"
              aria-label={`Debtor ${row.alias}`}
              aria-valuemin={0}
              aria-valuemax={audit.concentrationLimitPercent}
              aria-valuenow={Math.min(row.fundPercent, audit.concentrationLimitPercent)}
            >
              <span className="exposure-fill" style={{ width: `${row.barPercent}%` }} />
            </span>
            <span className="exposure-value">
              {formatPercent(row.fundPercent)} of the fund · {row.loans} {row.loans === 1 ? "loan" : "loans"}
              {row.breach ? ` · above ${limit}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
