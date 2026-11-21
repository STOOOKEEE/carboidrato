// Espace prêteur `#/lend` : compte vérifié (KYC_INVESTOR) qui donne accès au vault du fonds.
import type { AccountView } from "../../../../src/api/contract";
import { AccountCard } from "../account/AccountCard";

export function LendPage({ user }: { user: AccountView }) {
  return (
    <main className="app">
      <div className="section-head">
        <span className="kicker">Lend</span>
        <h1>Your position.</h1>
        <p className="lead">
          Your shares are a token on the XRP Ledger. Exit anytime: free at maturity, or now through Bari at −0.5%.
        </p>
      </div>
      <AccountCard user={user} />
    </main>
  );
}
