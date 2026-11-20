import { useState, type FormEvent } from "react";
import { submitKyb } from "../api";
import { DitherCanvas } from "../dither/DitherCanvas";

type KybState = { stage: "form" } | { stage: "verifying" } | { stage: "done"; explorerUrl: string } | { stage: "error"; message: string };

interface KybStepProps {
  /** Compte XRPL connu (celui de la facture vérifiée), pré-rempli. */
  account: string;
  alreadyDone: boolean;
  onDone: (account: string) => void;
}

export function KybStep({ account: initialAccount, alreadyDone, onDone }: KybStepProps) {
  const [state, setState] = useState<KybState>({ stage: "form" });
  const [company, setCompany] = useState("");
  const [vatNumber, setVatNumber] = useState("");
  const [account, setAccount] = useState(initialAccount);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setState({ stage: "verifying" });
    try {
      const response = await submitKyb({ account: account.trim(), company: company.trim(), vatNumber: vatNumber.trim() });
      setState({ stage: "done", explorerUrl: response.explorerUrl });
      onDone(response.account);
    } catch (error) {
      setState({ stage: "error", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const done = alreadyDone || state.stage === "done";
  return (
    <div className="kyb">
      <DitherCanvas
        shape="shield"
        scanning={state.stage === "verifying"}
        tone={state.stage === "error" ? "danger" : "light"}
        interactive
        cell={6}
        className="kyb-canvas"
      />
      {done ? (
        <div className="result">
          <span className="pill pill-ok">KYB verified</span>
          <p className="muted">
            Your <code>KYB_PME</code> credential is on XRPL: Bari's lending checks read it before co-signing any loan.
          </p>
          {state.stage === "done" && (
            <a className="link" href={state.explorerUrl} target="_blank" rel="noreferrer">
              See it on the explorer ↗
            </a>
          )}
        </div>
      ) : (
        <form className="form" onSubmit={(event) => void submit(event)}>
          <label>
            Company name
            <input value={company} onChange={(event) => setCompany(event.target.value)} placeholder="Marco Costruzioni S.r.l." required />
          </label>
          <label>
            VAT number (P.IVA)
            <input value={vatNumber} onChange={(event) => setVatNumber(event.target.value)} placeholder="IT01234567890" required />
          </label>
          <label>
            XRPL account
            <input className="mono" value={account} onChange={(event) => setAccount(event.target.value)} placeholder="r…" required />
          </label>
          {state.stage === "error" && <p className="error">{state.message}</p>}
          <button type="submit" className="button" disabled={state.stage === "verifying"}>
            {state.stage === "verifying" ? "Issuing credential on XRPL…" : "Verify my business"}
          </button>
        </form>
      )}
    </div>
  );
}
