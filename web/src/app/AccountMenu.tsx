// Menu du compte connecté : email, rôle, niveau de vérification affiché tel quel, accès à l'espace, déconnexion.
import { useEffect, useRef, useState } from "react";
import type { AccountView } from "../../../src/api/contract";
import { accountHandle, accountName, ROLE_COPY } from "../features/account/roles";
import { LANDING_ROUTE, spaceRoute } from "../routes";
import { signOut } from "../session";
import { Button } from "../ui/Button";
import { Notice } from "../ui/Notice";

export function AccountMenu({ user }: { user: AccountView }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const menu = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const close = () => menu.current?.removeAttribute("open");
    window.addEventListener("hashchange", close);
    return () => window.removeEventListener("hashchange", close);
  }, []);

  const leave = () => {
    setPending(true);
    setError(undefined);
    signOut()
      .then(() => window.location.assign(LANDING_ROUTE))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setPending(false));
  };

  return (
    <details className="account-menu" data-testid="account-menu" ref={menu}>
      <summary className="button button-ghost" title={user.email ?? user.address}>
        <span className="account-menu-email">{accountHandle(user)}</span>
      </summary>
      <div className="account-menu-panel">
        <p className="account-menu-name">{accountName(user)}</p>
        <p className="muted small">
          {ROLE_COPY[user.role].name} · Verification: {user.verification}
        </p>
        <a className="link" href={spaceRoute(user.role)}>
          Open my space
        </a>
        <Button variant="ghost" onClick={leave} disabled={pending} reason="Signing out…">
          Sign out
        </Button>
        {error !== undefined && <Notice kind="error">{error}</Notice>}
      </div>
    </details>
  );
}
