import { useState } from "react";
import type { PrecheckResponse } from "../../../src/api/contract";
import { InvoiceChecker } from "../components/InvoiceChecker";
import { Nav } from "../components/Nav";
import { OfferTable } from "../components/OfferTable";
import { formatEur } from "../format";
import { loadPrecheck } from "../session";
import { Button } from "../ui/Button";
import { StepCard } from "../ui/StepCard";

export function AppPage() {
  const [precheck, setPrecheck] = useState<PrecheckResponse | undefined>(loadPrecheck);
  const offer = precheck?.verdict === "eligible" ? precheck.offer : undefined;
  const kybDone = precheck?.kyb.done ?? false;

  return (
    <div className="page">
      <Nav inApp />
      <main className="app">
        <div className="section-head">
          <span className="kicker">Your space</span>
          <h1>
            From invoice to <span className="underline">cash</span>.
          </h1>
        </div>
        <StepCard index={1} title="Your invoice" done={offer !== undefined}>
          {precheck !== undefined && offer !== undefined ? (
            <div className="invoice-summary">
              <p className="muted">
                Invoice {precheck.invoice.number} · {precheck.invoice.debtorName}
              </p>
              <p className="amount">{formatEur(offer.netAdvanceEur)}</p>
              <OfferTable offer={offer} dueDate={precheck.invoice.dueDate} />
              <Button variant="ghost" onClick={() => setPrecheck(undefined)}>
                Use another invoice
              </Button>
            </div>
          ) : (
            <InvoiceChecker onEligible={setPrecheck} showCta={false} />
          )}
        </StepCard>
        <StepCard index={2} title="Get funded" done={false}>
          <p className="muted">
            {kybDone && offer !== undefined
              ? `Ready: ${formatEur(offer.netAdvanceEur)} as soon as the proof is generated and the loan is co-signed.`
              : "Check your invoice above, from a business account verified on Bari, to unlock your advance."}
          </p>
          <Button disabled reason="Request funding · next iteration">
            Request funding · next iteration
          </Button>
        </StepCard>
      </main>
    </div>
  );
}
