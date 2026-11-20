import type { PrecheckResponse } from "../../../src/api/contract";
import { firstFailure } from "../copy";
import { formatDate, formatEur, shortHash } from "../format";
import { APP_ROUTE } from "../routes";
import { Button } from "../ui/Button";
import { ChecksList } from "./ChecksList";
import { OfferTable } from "./OfferTable";

interface ResultPanelProps {
  result: PrecheckResponse;
  onReset: () => void;
  /** Bouton vers l'app (masqué quand on y est déjà). */
  showCta: boolean;
}

export function ResultPanel({ result, onReset, showCta }: ResultPanelProps) {
  const { invoice, offer, kyb } = result;
  if (result.verdict === "rejected" || offer === undefined) {
    const failure = firstFailure(result.checks);
    return (
      <div className="result">
        <span className="kicker kicker-danger">Not eligible</span>
        <h3 className="result-title">{failure?.rejection ?? "Not eligible"}</h3>
        <p className="muted">
          Invoice {invoice.number} · {invoice.debtorName}
        </p>
        <ChecksList checks={result.checks} />
        <Button variant="ghost" onClick={onReset}>
          Try another invoice
        </Button>
      </div>
    );
  }
  return (
    <div className="result">
      <div className="result-head">
        <span className="kicker">Eligible</span>
        <span className={kyb.done ? "pill pill-ok" : "pill"}>{kyb.done ? "KYB verified" : "KYB needed · 2 min"}</span>
      </div>
      <p className="muted">We can advance you</p>
      <p className="amount">{formatEur(offer.netAdvanceEur)}</p>
      <p className="muted">
        on your {formatEur(invoice.amountEur)} invoice to {invoice.debtorName}, due {formatDate(invoice.dueDate)}
      </p>
      <ChecksList checks={result.checks} />
      <OfferTable offer={offer} dueDate={invoice.dueDate} />
      <div className="result-actions">
        {showCta && (
          <a className="button" href={APP_ROUTE}>
            {kyb.done ? `Get ${formatEur(offer.netAdvanceEur)}` : "Complete KYB & get paid"} →
          </a>
        )}
        <Button variant="ghost" onClick={onReset}>
          Try another
        </Button>
      </div>
      <p className="fineprint">
        Fingerprint N <code>{shortHash(result.nullifier)}</code> · subject to fund capacity and the 20% per-debtor cap.
      </p>
    </div>
  );
}
