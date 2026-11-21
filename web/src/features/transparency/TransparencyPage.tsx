// Page publique `#/transparency` : chaque prêt du fonds relu sur le ledger, sa preuve re-vérifiée dans le navigateur.
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { FundAudit } from "../../../../src/api/contract";
import { Details } from "../../ui/Details";
import { Notice } from "../../ui/Notice";
import { fetchLendFund } from "../lend/api";
import type { LendFund } from "../lend/lend.machine";
import { fetchAudit, fetchVerificationKey } from "./api";
import { ExposureBars } from "./ExposureBars";
import { LoanTable } from "./LoanTable";
import { ProofPanel } from "./ProofPanel";
import { initialVerification, verificationTransition, verifyLoans } from "./transparency";
import { browserVerifier } from "./verifier";

type AuditView = { status: "loading" } | { status: "ready"; audit: FundAudit; fund?: LendFund } | { status: "error"; message: string };

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** Audit et fonds lus en parallèle ; sans le fonds, seul le taux d'utilisation manque. */
function useAudit(): AuditView {
  const [view, setView] = useState<AuditView>({ status: "loading" });
  useEffect(() => {
    let current = true;
    Promise.all([fetchAudit(), fetchLendFund().catch(() => undefined)])
      .then(([audit, fund]) => current && setView({ status: "ready", audit, fund }))
      .catch((cause: unknown) => current && setView({ status: "error", message: messageOf(cause) }));
    return () => {
      current = false;
    };
  }, []);
  return view;
}

/** Vérifie toutes les preuves dès l'arrivée de l'audit, puis à chaque relance ; la clé n'est chargée qu'une fois. */
function useVerification(audit: FundAudit | undefined) {
  const [run, dispatch] = useReducer(verificationTransition, initialVerification);
  const key = useRef<Promise<unknown>>(undefined);
  const verify = useCallback(() => {
    if (audit === undefined) return;
    dispatch({ type: "START" });
    key.current ??= fetchVerificationKey();
    key.current
      .then(async (verificationKey) => {
        const startedAt = performance.now();
        const verdicts = await verifyLoans(audit, browserVerifier(verificationKey));
        dispatch({ type: "DONE", verdicts, durationMs: performance.now() - startedAt });
      })
      .catch((cause: unknown) => {
        key.current = undefined;
        dispatch({
          type: "FAILED",
          message: `Could not load the verification key from Bari's server (${messageOf(cause)}). Check your connection, then re-verify.`,
        });
      });
  }, [audit]);
  useEffect(() => {
    if (audit !== undefined && audit.loanAudits.length > 0) verify();
  }, [audit, verify]);
  return { run, verify };
}

export function TransparencyPage() {
  const view = useAudit();
  const audit = view.status === "ready" ? view.audit : undefined;
  const { run, verify } = useVerification(audit);
  return (
    <main className="app transparency">
      <div className="section-head">
        <span className="kicker">Transparency</span>
        <h1>Every loan, in the open.</h1>
        <p className="lead">
          Your browser reads every loan of the fund from the XRP Ledger and checks its zero-knowledge proof itself. No
          invoice is shown, and none can be financed twice.
        </p>
      </div>
      {view.status === "loading" && <Notice kind="info">Reading the fund's loans from the XRP Ledger…</Notice>}
      {view.status === "error" && (
        <div className="lend-status">
          <Notice kind="error">Could not read the fund's loans from the ledger.</Notice>
          <p className="muted small">Bari's server may be restarting: reload the page in a few seconds.</p>
          <Details>
            <p className="mono small">{view.message}</p>
          </Details>
        </div>
      )}
      {view.status === "ready" && (
        <>
          <ProofPanel audit={view.audit} fund={view.fund} run={run} onVerify={verify} />
          {view.audit.loanAudits.length > 0 && (
            <>
              <LoanTable audit={view.audit} run={run} />
              <ExposureBars audit={view.audit} />
            </>
          )}
        </>
      )}
    </main>
  );
}
