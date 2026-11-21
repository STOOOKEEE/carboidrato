// Panneau de la zone de dépôt : consigne sans fichier, contrôle en cours, fichier refusé, ou facture lue et ses contrôles.
import { formatDate, formatUsd } from "../../format";
import { Notice } from "../../ui/Notice";
import { invoiceChecks, type BusinessState } from "./business.machine";
import { CheckList } from "./CheckList";

export function InvoicePanel({ state }: { state: BusinessState }) {
  switch (state.status) {
    case "empty":
      return (
        <div className="result" data-testid="business-next-step">
          <h3 className="panel-title">Ask your client to confirm your invoice on Atlas.</h3>
          <p className="muted">
            The public body you invoiced confirms it on Atlas and sends you a signed PDF. Drop that PDF here, or click the
            drop area to choose it: it is checked in this browser and never uploaded.
          </p>
        </div>
      );
    case "checking":
      return <Notice kind="info">Checking {state.fileName} in this browser…</Notice>;
    case "unreadable":
      return <Notice kind="error">{state.message}</Notice>;
    case "checked": {
      const { invoice } = state.precheck;
      return (
        <div className="result">
          <h3 className="panel-title">Invoice {invoice.number}</h3>
          <p className="muted">
            {invoice.debtorName} · {formatUsd(invoice.amountUsd)} · due {formatDate(invoice.dueDate)}. This amount stays in this
            page.
          </p>
          <CheckList checks={invoiceChecks(state.precheck)} testId="invoice-checks" />
        </div>
      );
    }
  }
}
