// Tableau « My invoices » : factures certifiées du compte, statut, montants, échéance, liens ; relu après un financement.
import { useEffect, useState } from "react";
import { formatDate, formatRlusd, shortHash } from "../../format";
import { Notice } from "../../ui/Notice";
import { TxLink } from "../../ui/TxLink";
import { fetchBusinessInvoices } from "./api";
import { invoiceRows, type InvoiceRow } from "./business.machine";

type InvoicesView = { status: "loading" } | { status: "ready"; rows: InvoiceRow[] } | { status: "error"; message: string };

/** `version` change après un financement : la liste est relue, l'ancienne reste affichée en attendant. */
function useInvoices(version: string): InvoicesView {
  const [view, setView] = useState<InvoicesView>({ status: "loading" });
  useEffect(() => {
    let current = true;
    fetchBusinessInvoices()
      .then((invoices) => current && setView({ status: "ready", rows: invoiceRows(invoices) }))
      .catch((error: unknown) => current && setView({ status: "error", message: error instanceof Error ? error.message : String(error) }));
    return () => {
      current = false;
    };
  }, [version]);
  return view;
}

const amount = (rlusd: number | undefined) => (rlusd === undefined ? "—" : formatRlusd(rlusd));

export function MyInvoices({ version }: { version: string }) {
  const view = useInvoices(version);
  return (
    <section className="step" data-testid="my-invoices">
      <h2>My invoices</h2>
      {view.status === "loading" && <Notice kind="info">Reading your invoices from Bari…</Notice>}
      {view.status === "error" && <Notice kind="error">Could not load your invoices: {view.message} Reload the page to try again.</Notice>}
      {view.status === "ready" && view.rows.length === 0 && (
        <p className="muted">No invoice yet. Each invoice you turn into a certificate appears here, with its loan.</p>
      )}
      {view.status === "ready" && view.rows.length > 0 && (
        <table className="invoices">
          <thead>
            <tr>
              <th>Fingerprint</th>
              <th>Status</th>
              <th>Advance</th>
              <th>Fee</th>
              <th>Received</th>
              <th>Due date</th>
              <th>Certificate</th>
              <th>Loan</th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row) => (
              <tr key={row.id}>
                <td data-label="Fingerprint" className="mono" title={row.fingerprint}>
                  {shortHash(row.fingerprint, 4)}
                </td>
                <td data-label="Status">{row.status}</td>
                <td data-label="Advance" className="num">
                  {amount(row.advanceRlusd)}
                </td>
                <td data-label="Fee" className="num">
                  {amount(row.feeRlusd)}
                </td>
                <td data-label="Received" className="num">
                  {amount(row.netRlusd)}
                </td>
                <td data-label="Due date">{row.dueDate === undefined ? "—" : formatDate(row.dueDate)}</td>
                <td data-label="Certificate">{row.certificateTxHash === undefined ? "—" : <TxLink hash={row.certificateTxHash} />}</td>
                <td data-label="Loan">{row.loanTxHash === undefined ? "—" : <TxLink hash={row.loanTxHash} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
