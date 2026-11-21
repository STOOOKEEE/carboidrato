// Connexion : page `#/signin`, ou porte d'un espace visité sans session (le rôle attendu oriente vers l'inscription).
import { useReducer, useState, type SubmitEvent } from "react";
import type { UserRole } from "../../../../src/api/contract";
import { signIn } from "../../api";
import { signupRoute } from "../../routes";
import { sessionStarted } from "../../session";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { Notice } from "../../ui/Notice";
import { formTransition, initialFormState, validateSignin } from "./account.machine";
import { ROLE_COPY } from "./roles";

const SPACE_TITLES: Record<UserRole, string> = {
  lender: "Sign in to lend.",
  business: "Sign in to get paid.",
  public_body: "Sign in to confirm invoices.",
};

const SIGNUP_LINKS: Record<UserRole, string> = {
  lender: "Open a lender account",
  business: "Open a business account",
  public_body: "Register your public body",
};

export function SigninPage({ role }: { role?: UserRole }) {
  const [draft, setDraft] = useState({ email: "", password: "" });
  const [state, dispatch] = useReducer(formTransition, initialFormState);
  const errors = state.status === "editing" ? state.errors : {};
  const submitting = state.status === "submitting";

  const update = (field: "email" | "password", value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    dispatch({ type: "EDIT", field });
  };

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (submitting) return;
    const validation = validateSignin(draft);
    dispatch({ type: "SUBMIT", validation: validation.ok ? { ok: true } : validation });
    if (!validation.ok) return;
    signIn(validation.request)
      .then((response) => {
        dispatch({ type: "SUCCEEDED", transactions: [] });
        sessionStarted(response.user);
      })
      .catch((cause: unknown) => dispatch({ type: "FAILED", message: cause instanceof Error ? cause.message : String(cause) }));
  };

  const signupRoles: UserRole[] = role === undefined ? ["lender", "business", "public_body"] : [role];

  return (
    <main className="app">
      <div className="section-head">
        <span className="kicker">{role === undefined ? "Sign in" : ROLE_COPY[role].space}</span>
        <h1>{role === undefined ? "Welcome back." : SPACE_TITLES[role]}</h1>
        <p className="lead">One account, one role: you land straight in your space.</p>
      </div>
      <form className="form" onSubmit={submit} noValidate>
        <Field label="Email" error={errors.email}>
          <input type="email" autoComplete="email" value={draft.email} onChange={(event) => update("email", event.target.value)} />
        </Field>
        <Field label="Password" error={errors.password}>
          <input
            type="password"
            autoComplete="current-password"
            value={draft.password}
            onChange={(event) => update("password", event.target.value)}
          />
        </Field>
        <Button type="submit" primary disabled={submitting} reason="Signing in…">
          Sign in
        </Button>
        {state.status === "failed" && <Notice kind="error">{state.message}</Notice>}
        <p className="muted small">
          New to Bari?{" "}
          {signupRoles.map((signupRole, index) => (
            <span key={signupRole}>
              {index > 0 && " · "}
              <a className="link" href={signupRoute(signupRole)}>
                {SIGNUP_LINKS[signupRole]}
              </a>
            </span>
          ))}
        </p>
      </form>
    </main>
  );
}
