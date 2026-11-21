// Espace organisme public `#/public` : organisme du registre vérifié, qui confirme les factures de ses fournisseurs.
import type { AccountView } from "../../../../src/api/contract";
import { AccountCard } from "../account/AccountCard";

export function PublicBodyPage({ user }: { user: AccountView }) {
  return (
    <main className="app">
      <div className="section-head">
        <span className="kicker">Public bodies</span>
        <h1>Confirm your suppliers' invoices.</h1>
        <p className="lead">Signed in your browser. Bari never receives this invoice.</p>
      </div>
      <AccountCard user={user} />
    </main>
  );
}
