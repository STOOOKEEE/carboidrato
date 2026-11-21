// Tableau des prêts du fonds : statut, montant, échéance, débiteur, empreinte, verdict de la preuve et lien du LoanSet.
import type { FundAudit } from "../../../../src/api/contract";
import { TxLink } from "../../ui/TxLink";
import { loanRows, type Verification } from "./transparency";

export function LoanTable({ audit, run }: { audit: FundAudit; run: Verification }) {
  return (
    <section className="step" data-testid="transparency-loans">
      <h2>Loans</h2>
      <table className="invoices">
        <thead>
          <tr>
            <th>Loan</th>
            <th>Status</th>
            <th>Principal</th>
            <th>Due date</th>
            <th>Debtor</th>
            <th>Fingerprint</th>
            <th>Proof</th>
            <th>Transaction</th>
          </tr>
        </thead>
        <tbody>
          {loanRows(audit, run).map((row) => (
            <tr key={row.id}>
              <td data-label="Loan" className="num">
                #{row.sequence}
              </td>
              <td data-label="Status">{row.status}</td>
              <td data-label="Principal" className="num">
                {row.principal}
              </td>
              <td data-label="Due date">{row.due}</td>
              <td data-label="Debtor" className="mono" title={row.pseudonym}>
                {row.debtor}
              </td>
              <td data-label="Fingerprint" className="mono" title={row.nullifier}>
                {row.fingerprint}
              </td>
              <td data-label="Proof" className={row.proofState === "bad" ? "transparency-bad" : undefined}>
                {row.proofState === "ok" ? "✓ " : ""}
                {row.proof}
              </td>
              <td data-label="Transaction">
                <TxLink hash={row.hash} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
