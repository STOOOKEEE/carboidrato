// Espace d'un autre rôle : explication, lien vers son propre espace et déconnexion.
import { useState } from "react";
import type { AccountView, UserRole } from "../../../src/api/contract";
import { accountHandle, ROLE_COPY } from "../features/account/roles";
import { spaceRoute } from "../routes";
import { signOut } from "../session";
import { Button } from "../ui/Button";
import { Notice } from "../ui/Notice";

export function WrongRole({ required, user }: { required: UserRole; user: AccountView }) {
  const [error, setError] = useState<string>();
  const leave = () =>
    signOut().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));

  return (
    <main className="app">
      <div className="section-head">
        <span className="kicker">{ROLE_COPY[required].space}</span>
        <h1>This space is for {ROLE_COPY[required].audience}.</h1>
        <p className="lead">
          You are signed in as {accountHandle(user)}, a {ROLE_COPY[user.role].name.toLowerCase()} account. Each account has one
          role.
        </p>
      </div>
      <div className="result-actions" data-testid="wrong-role">
        <a className="button" href={spaceRoute(user.role)} data-primary="">
          Open my space
        </a>
        <Button variant="ghost" onClick={leave}>
          Sign out to use another account
        </Button>
      </div>
      {error !== undefined && <Notice kind="error">{error}</Notice>}
    </main>
  );
}
