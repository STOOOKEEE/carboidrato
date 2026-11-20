// Page `#/tx/<hash>` : détail d'une transaction lu par l'API sur le nœud, preuve décodée si c'est un certificat.
import { useEffect, useState } from "react";
import { Nav } from "../../components/Nav";
import { parseJsonOrUndefined } from "../../json";
import { Details } from "../../ui/Details";
import { Notice } from "../../ui/Notice";
import { TxLink } from "../../ui/TxLink";
import { certificateFacts, initialTxView, keyFacts, txExplanation, txTitle, txViewFromResponse, type Fact, type TxView } from "./txView";

function FactList({ facts }: { facts: Fact[] }) {
  return (
    <dl className="offer-table tx-facts">
      {facts.map(({ label, value }, index) => (
        <div className="offer-row" key={`${index}-${label}`}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function useTxView(hash: string): TxView {
  const [view, setView] = useState<TxView>(() => initialTxView(hash));
  useEffect(() => {
    const initial = initialTxView(hash);
    setView(initial);
    if (initial.status !== "loading") return;
    const controller = new AbortController();
    fetch(`/api/tx/${hash}`, { signal: controller.signal })
      .then(async (response) => setView(txViewFromResponse(response.status, parseJsonOrUndefined(await response.text()))))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setView({ status: "error", message: error instanceof Error ? error.message : String(error) });
        }
      });
    return () => controller.abort();
  }, [hash]);
  return view;
}

export function TxPage({ hash }: { hash: string }) {
  const view = useTxView(hash);
  return (
    <div className="page">
      <Nav inApp />
      <main className="app">
        <div className="section-head">
          <span className="kicker">Transaction</span>
          <h1 className="tx-title">{view.status === "ready" ? txTitle(view.detail) : "Transaction details"}</h1>
          <p className="mono tx-hash">{hash}</p>
        </div>
        {view.status === "invalid" && <Notice kind="error">This is not a transaction hash.</Notice>}
        {view.status === "loading" && <Notice kind="info">Reading the transaction from the ledger…</Notice>}
        {view.status === "notFound" && <Notice kind="error">This transaction is not on the ledger (yet).</Notice>}
        {view.status === "error" && <Notice kind="error">{view.message}</Notice>}
        {view.status === "ready" && (
          <>
            <section className="step">
              <p className="muted">{txExplanation(view.detail.type)}</p>
              <FactList facts={keyFacts(view.detail)} />
              {view.detail.explorerUrl !== undefined && (
                <a className="link" href={view.detail.explorerUrl} target="_blank" rel="noreferrer">
                  Open in the XRPL explorer
                </a>
              )}
            </section>
            {view.detail.certificate !== undefined && (
              <section className="step">
                <h2>Invoice certificate</h2>
                <p className="muted">
                  Public values of the zero-knowledge proof, read from the invoice token metadata. The invoice itself stays private.
                </p>
                <FactList facts={certificateFacts(view.detail.certificate)} />
              </section>
            )}
            {view.detail.innerTransactions.length > 0 && (
              <section className="step">
                <h2>Inner transactions</h2>
                <ul className="tx-list">
                  {view.detail.innerTransactions.map((inner) => (
                    <li key={inner.hash}>
                      {inner.type} <TxLink hash={inner.hash} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {view.detail.createdObjects.length > 0 && (
              <section className="step">
                <h2>Created objects</h2>
                <FactList facts={view.detail.createdObjects.map(({ type, index }) => ({ label: type, value: index }))} />
              </section>
            )}
            <Details summary="raw transaction">
              <pre className="tx-raw">{JSON.stringify(view.detail.raw, null, 2)}</pre>
            </Details>
          </>
        )}
      </main>
    </div>
  );
}
