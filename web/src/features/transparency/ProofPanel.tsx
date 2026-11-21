// Chiffres clés du fonds, vérification des preuves dans le navigateur avec sa relance, contrôles en clair et détails.
import type { FundAudit } from "../../../../src/api/contract";
import { Button } from "../../ui/Button";
import { Details } from "../../ui/Details";
import { Facts } from "../../ui/Facts";
import { Notice } from "../../ui/Notice";
import { CheckList } from "../business/CheckList";
import type { LendFund } from "../lend/lend.machine";
import { fundChecks, keyFigures, runSummary, type Verification } from "./transparency";

interface ProofPanelProps {
  audit: FundAudit;
  fund: LendFund | undefined;
  run: Verification;
  onVerify: () => void;
}

function VerificationStatus({ run }: { run: Verification }) {
  if (run.status === "failed") return <Notice kind="error">{runSummary(run)}</Notice>;
  const done = run.status === "done";
  return (
    <p className={done ? "transparency-status" : "transparency-status pending"} role="status" data-testid="transparency-verification" data-round={run.round}>
      <span className="step-index">■</span> {runSummary(run)}
    </p>
  );
}

export function ProofPanel({ audit, fund, run, onVerify }: ProofPanelProps) {
  const empty = audit.loanAudits.length === 0;
  const figures = keyFigures(audit, fund, run).filter((figure) => !(empty && figure.id === "proofs"));
  const verifying = run.status === "verifying";
  return (
    <section className="step" data-testid="transparency-fund">
      <dl className="lend-figures transparency-figures">
        {figures.map((figure) => (
          <div key={figure.id}>
            <dt>{figure.label}</dt>
            <dd data-testid={`transparency-${figure.id}`}>{figure.value}</dd>
          </div>
        ))}
      </dl>
      {fund === undefined && (
        <p className="muted small">The share of the fund lent out is unavailable right now: reload the page to try again.</p>
      )}
      {empty ? (
        <p className="muted">
          No loans yet. When a business gets paid for an invoice, its loan and proof appear here, checked in your browser.
        </p>
      ) : (
        <>
          <div className="transparency-verify">
            <Button primary onClick={onVerify} disabled={verifying} reason="Verifying…">
              {verifying ? "Verifying…" : "Re-verify in my browser"}
            </Button>
            <VerificationStatus run={run} />
          </div>
          <CheckList checks={fundChecks(audit)} testId="transparency-checks" />
        </>
      )}
      <Details summary="how this is checked">
        <Facts
          className="tx-facts"
          facts={[
            { label: "Proof", value: "Groth16 zero-knowledge proof (BN254), verified with snarkjs in this page" },
            {
              label: "Verification key",
              value: (
                <a className="link" href="/api/zk/verification_key.json" target="_blank" rel="noreferrer">
                  verification_key.json
                </a>
              ),
            },
            { label: "Fingerprint", value: "Nullifier N: the same invoice always gives the same one" },
            { label: "Debtor alias", value: "Pseudonym P: one per debtor, valid in this fund only" },
            { label: "Each proof binds", value: "N and P of its LoanSet, the verified debtors root, the fund vintage" },
            { label: "Verified debtors root", value: audit.manifest.debtorsRoot },
            { label: "Vintage", value: String(audit.manifest.vintage) },
            { label: "Vault", value: audit.vaultId },
            { label: "Loan broker", value: audit.brokerId },
          ]}
        />
      </Details>
    </section>
  );
}
