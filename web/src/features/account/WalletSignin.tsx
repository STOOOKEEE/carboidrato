// Connexion par wallet Otsu : connexion, signature du défi, puis session, ou KYC léger d'un wallet inconnu.
import { useReducer, useState, type SubmitEvent } from "react";
import type { WalletRole } from "../../../../src/api/contract";
import { fetchNetwork, registerWallet, requestWalletChallenge, verifyWallet } from "../../api";
import { sessionStarted } from "../../session";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { Notice } from "../../ui/Notice";
import { otsuProvider } from "../../wallet/otsu";
import {
  EMPTY_DRAFT,
  formTransition,
  initialFormState,
  validateWalletRegistration,
  type DraftField,
  type SignupDraft,
} from "./account.machine";
import { ProfileFields } from "./ProfileFields";
import { ROLE_COPY } from "./roles";
import { failureHelp, signInWithWallet, STEP_LABELS, type WalletFailure, type WalletStep } from "./wallet.machine";

type Phase =
  | { status: "idle" }
  | { status: "busy"; step: WalletStep }
  | { status: "failed"; failure: WalletFailure }
  | { status: "register"; address: string; token: string };

const WALLET_ROLES: WalletRole[] = ["lender", "business"];

function Registration({ address, token, role }: { address: string; token: string; role?: WalletRole }) {
  const [chosenRole, setChosenRole] = useState<WalletRole>(role ?? "lender");
  const [draft, setDraft] = useState<SignupDraft>(EMPTY_DRAFT);
  const [state, dispatch] = useReducer(formTransition, initialFormState);
  const errors = state.status === "editing" ? state.errors : {};
  const submitting = state.status === "submitting" || state.status === "done";

  const update = <K extends DraftField>(field: K, value: SignupDraft[K]) => {
    setDraft((current) => ({ ...current, [field]: value }));
    dispatch({ type: "EDIT", field });
  };

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (submitting) return;
    const validation = validateWalletRegistration(chosenRole, draft, token);
    dispatch({ type: "SUBMIT", validation: validation.ok ? { ok: true } : validation });
    if (!validation.ok) return;
    registerWallet(validation.request)
      .then((response) => {
        dispatch({ type: "SUCCEEDED", transactions: [] });
        sessionStarted(response.user);
      })
      .catch((cause: unknown) => dispatch({ type: "FAILED", message: cause instanceof Error ? cause.message : String(cause) }));
  };

  return (
    <form className="form step" onSubmit={submit} noValidate data-testid="wallet-registration">
      <h2>New to Bari? Tell us who you are.</h2>
      <p className="muted">
        Wallet <span className="mono">{address}</span> is verified. Bari never holds its keys.
      </p>
      {role === undefined && (
        <Field label="Account type">
          <select value={chosenRole} onChange={(event) => setChosenRole(event.target.value as WalletRole)}>
            {WALLET_ROLES.map((option) => (
              <option key={option} value={option}>
                {ROLE_COPY[option].name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <ProfileFields role={chosenRole} draft={draft} errors={errors} update={update} />
      <p className="muted small">Verification: basic (self-declared).</p>
      <Button type="submit" primary disabled={submitting} reason="Creating your account…">
        Create my account
      </Button>
      {state.status === "failed" && <Notice kind="error">{state.message}</Notice>}
    </form>
  );
}

function Failure({ failure }: { failure: WalletFailure }) {
  const help = failureHelp(failure);
  return (
    <div role="alert" className="field">
      <p className="error">{help.message}</p>
      <p className="muted small">{help.fix}</p>
      {help.link !== undefined && (
        <a className="link" href={help.link.href} target="_blank" rel="noreferrer">
          {help.link.label}
        </a>
      )}
    </div>
  );
}

export function WalletSignin({ role }: { role?: WalletRole }) {
  const [phase, setPhase] = useState<Phase>({ status: "idle" });

  if (phase.status === "register") return <Registration address={phase.address} token={phase.token} role={role} />;

  const connect = () => {
    setPhase({ status: "busy", step: "connecting" });
    const deps = { provider: otsuProvider(), fetchNetwork, challenge: requestWalletChallenge, verify: verifyWallet, now: Date.now };
    void signInWithWallet(deps, (step) => setPhase({ status: "busy", step })).then((outcome) => {
      switch (outcome.kind) {
        case "signedIn":
          sessionStarted(outcome.user);
          return;
        case "register":
          setPhase({ status: "register", address: outcome.address, token: outcome.token });
          return;
        case "failed":
          setPhase({ status: "failed", failure: outcome.failure });
      }
    });
  };

  const busy = phase.status === "busy";
  return (
    <div className="form">
      <p className="muted">Sign with your Otsu wallet: Bari never sees your keys and nothing is sent to the ledger.</p>
      <Button primary onClick={connect} disabled={busy} reason={busy ? STEP_LABELS[phase.step] : ""}>
        Connect Otsu wallet
      </Button>
      {phase.status === "failed" && <Failure failure={phase.failure} />}
    </div>
  );
}
