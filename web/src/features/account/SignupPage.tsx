// Inscription par rôle (`#/signup/<rôle>`) : KYC léger, puis « Verifying… » avec les transactions d'ouverture du compte.
import { useEffect, useReducer, useState, type ReactNode, type SubmitEvent } from "react";
import type { AccountView, PublicBodyOption, UserRole } from "../../../../src/api/contract";
import { fetchPublicBodies, signUp } from "../../api";
import { SIGNIN_ROUTE, signupRoute, spaceRoute } from "../../routes";
import { sessionStarted, useSession } from "../../session";
import { Button } from "../../ui/Button";
import { Details } from "../../ui/Details";
import { Field } from "../../ui/Field";
import { Notice } from "../../ui/Notice";
import {
  EMPTY_DRAFT,
  formTransition,
  initialFormState,
  validateSignup,
  verificationSteps,
  type DraftField,
  type SignupDraft,
} from "./account.machine";
import { ProfileFields } from "./ProfileFields";
import { accountHandle, accountName, ROLE_COPY } from "./roles";
import { VerificationSteps } from "./VerificationSteps";

const HEADINGS: Record<UserRole, { title: string; lead: string }> = {
  lender: {
    title: "Open your lender account.",
    lead: "Atlas opens an XRP Ledger account for you and issues your KYC_INVESTOR credential: it is what lets you into the fund's vault.",
  },
  business: {
    title: "Open your business account.",
    lead: "Atlas opens an XRP Ledger account for your company and issues its KYB_PME credential, checked before every advance.",
  },
  public_body: {
    title: "Confirm invoices for your suppliers.",
    lead: "Choose your administration in Atlas's registry of verified public bodies. Confirming an invoice costs you nothing.",
  },
};

function usePublicBodies(enabled: boolean) {
  const [bodies, setBodies] = useState<PublicBodyOption[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!enabled) return;
    fetchPublicBodies()
      .then(setBodies)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [enabled]);
  return { bodies, error };
}

function AlreadySignedIn({ user }: { user: AccountView }) {
  return (
    <section className="step">
      <p>
        You are signed in as {accountHandle(user)} ({ROLE_COPY[user.role].name.toLowerCase()}). Each account has one role: sign
        out first to open another one.
      </p>
      <a className="button" href={spaceRoute(user.role)} data-primary="">
        Open my space
      </a>
    </section>
  );
}

export function SignupPage({ role }: { role: UserRole }) {
  const session = useSession();
  const [draft, setDraft] = useState<SignupDraft>(EMPTY_DRAFT);
  const [state, dispatch] = useReducer(formTransition, initialFormState);
  const [user, setUser] = useState<AccountView>();
  const publicBodies = usePublicBodies(role === "public_body");
  const errors = state.status === "editing" ? state.errors : {};
  const heading = HEADINGS[role];

  const update = <K extends DraftField>(field: K, value: SignupDraft[K]) => {
    setDraft((current) => ({ ...current, [field]: value }));
    dispatch({ type: "EDIT", field });
  };

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const validation = validateSignup(role, draft);
    dispatch({ type: "SUBMIT", validation: validation.ok ? { ok: true } : validation });
    if (!validation.ok) return;
    signUp(validation.request)
      .then((response) => {
        setUser(response.user);
        dispatch({ type: "SUCCEEDED", transactions: response.transactions });
        sessionStarted(response.user);
      })
      .catch((cause: unknown) => dispatch({ type: "FAILED", message: cause instanceof Error ? cause.message : String(cause) }));
  };

  let body: ReactNode;
  if (state.status === "submitting" || state.status === "done") {
    const done = state.status === "done";
    body = (
      <section className="step" aria-live="polite">
        <h2>{done ? "Your account is ready." : "Verifying…"}</h2>
        {role === "public_body" ? (
          <p className="muted">
            {done
              ? `${user === undefined ? "Your administration" : accountName(user)} is in Atlas's verified registry: no credential needed.`
              : "Checking your administration in Atlas's verified registry."}
          </p>
        ) : (
          <>
            <p className="muted">
              {done
                ? "Every step below is a transaction on the XRP Ledger. Open one to see it."
                : "Opening your XRP Ledger account and issuing your credential. This takes about 15 seconds."}
            </p>
            <VerificationSteps steps={verificationSteps(role, done ? state.transactions : undefined)} />
          </>
        )}
        {done && user !== undefined && (
          <>
            <p className="muted small">Verification: {user.verification}</p>
            {user.address !== undefined && (
              <Details summary="your XRPL account">
                <p className="mono">{user.address}</p>
              </Details>
            )}
            <a className="button" href={spaceRoute(role)} data-primary="">
              Open my space
            </a>
          </>
        )}
      </section>
    );
  } else if (session.status === "signedIn") {
    body = <AlreadySignedIn user={session.user} />;
  } else {
    body = (
      <form className="form" onSubmit={submit} noValidate>
        <Field label="Email" error={errors.email}>
          <input type="email" autoComplete="email" value={draft.email} onChange={(event) => update("email", event.target.value)} />
        </Field>
        <Field label="Password" error={errors.password} hint="At least 8 characters.">
          <input
            type="password"
            autoComplete="new-password"
            value={draft.password}
            onChange={(event) => update("password", event.target.value)}
          />
        </Field>
        {role !== "public_body" && <ProfileFields role={role} draft={draft} errors={errors} update={update} />}
        {role === "public_body" && (
          <Field label="Public body" error={errors.ipaCode ?? publicBodies.error}>
            <select value={draft.ipaCode} onChange={(event) => update("ipaCode", event.target.value)}>
              <option value="">{publicBodies.bodies === undefined ? "Loading the registry…" : "Choose…"}</option>
              {publicBodies.bodies?.map((body) => (
                <option key={body.ipaCode} value={body.ipaCode} disabled={!body.available}>
                  {body.available ? body.name : `${body.name} (already on Atlas)`}
                </option>
              ))}
            </select>
          </Field>
        )}
        <p className="muted small">
          Verification: {role === "public_body" ? "verified public body registry" : "basic (self-declared)"}.
        </p>
        <Button type="submit" primary>
          Create my account
        </Button>
        {state.status === "failed" && <Notice kind="error">{state.message}</Notice>}
        <p className="muted small">
          Already on Atlas?{" "}
          <a className="link" href={SIGNIN_ROUTE}>
            Sign in
          </a>
        </p>
      </form>
    );
  }

  return (
    <main className="app">
      <div className="section-head">
        <span className="kicker">{ROLE_COPY[role].space} · new account</span>
        <h1>{heading.title}</h1>
        <p className="lead">{heading.lead}</p>
      </div>
      {body}
      {state.status === "editing" && session.status !== "signedIn" && (
        <p className="muted small role-switch">
          Not a {ROLE_COPY[role].name.toLowerCase()}?{" "}
          {(Object.keys(ROLE_COPY) as UserRole[])
            .filter((other) => other !== role)
            .map((other, index) => (
              <span key={other}>
                {index > 0 && " · "}
                <a className="link" href={signupRoute(other)}>
                  {ROLE_COPY[other].name}
                </a>
              </span>
            ))}
        </p>
      )}
    </main>
  );
}
