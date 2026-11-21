// Espace entreprise `#/business` : la facture doit d'abord être confirmée par l'organisme public sur Bari.
import type { AccountView } from "../../../../src/api/contract";
import { AccountCard } from "../account/AccountCard";

export function BusinessPage({ user }: { user: AccountView }) {
  return (
    <main className="app">
      <div className="section-head">
        <span className="kicker">Business</span>
        <h1>Get paid now.</h1>
        <p className="lead">Your invoice never leaves this page. We only learn that it covers the advance.</p>
      </div>
      <section className="step" data-testid="business-next-step">
        <h2>Ask your client to confirm your invoice on Bari.</h2>
        <p className="muted">
          The public body you invoiced signs it in its own browser and sends you back a signed file. That file is all you
          need to get 90% of the invoice in seconds.
        </p>
      </section>
      <AccountCard user={user} />
    </main>
  );
}
