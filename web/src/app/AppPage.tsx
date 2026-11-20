import { useCallback, useState, type ReactNode } from "react";
import type { PrecheckResponse } from "../../../src/api/contract";
import { InvoiceChecker } from "../components/InvoiceChecker";
import { Nav } from "../components/Nav";
import { OfferTable } from "../components/OfferTable";
import { formatEur } from "../format";
import { loadPrecheck, savePrecheck } from "../session";
import { KybStep } from "./KybStep";

function Step({ index, title, done, children }: { index: number; title: string; done: boolean; children: ReactNode }) {
  return (
    <section className={done ? "step done" : "step"}>
      <header className="step-head">
        <span className="step-index">{done ? "■" : `0${index}`}</span>
        <h2>{title}</h2>
      </header>
      {children}
    </section>
  );
}

export function AppPage() {
  const [precheck, setPrecheck] = useState<PrecheckResponse | undefined>(loadPrecheck);
  const [kybDone, setKybDone] = useState(precheck?.kyb.done ?? false);
  const offer = precheck?.verdict === "eligible" ? precheck.offer : undefined;

  const onKybDone = useCallback(
    (account: string) => {
      setKybDone(true);
      if (precheck !== undefined && precheck.kyb.account === account) {
        const updated = { ...precheck, kyb: { account, done: true } };
        savePrecheck(updated);
        setPrecheck(updated);
      }
    },
    [precheck],
  );

  const onEligible = useCallback((result: PrecheckResponse) => {
    setPrecheck(result);
    if (result.kyb.done) setKybDone(true);
  }, []);

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
        <Step index={1} title="Verify your business" done={kybDone}>
          <KybStep account={precheck?.kyb.account ?? ""} alreadyDone={kybDone} onDone={onKybDone} />
        </Step>
        <Step index={2} title="Your invoice" done={offer !== undefined}>
          {precheck !== undefined && offer !== undefined ? (
            <div className="invoice-summary">
              <p className="muted">
                Invoice {precheck.invoice.number} · {precheck.invoice.debtorName}
              </p>
              <p className="amount">{formatEur(offer.netAdvanceEur)}</p>
              <OfferTable offer={offer} dueDate={precheck.invoice.dueDate} />
              <button type="button" className="button button-ghost" onClick={() => setPrecheck(undefined)}>
                Use another invoice
              </button>
            </div>
          ) : (
            <InvoiceChecker onEligible={onEligible} showCta={false} />
          )}
        </Step>
        <Step index={3} title="Get funded" done={false}>
          <p className="muted">
            {kybDone && offer !== undefined
              ? `Ready: ${formatEur(offer.netAdvanceEur)} as soon as the proof is generated and the loan is co-signed.`
              : "Complete the two steps above to unlock your advance."}
          </p>
          <button type="button" className="button" disabled>
            Request funding · next iteration
          </button>
        </Step>
      </main>
    </div>
  );
}
