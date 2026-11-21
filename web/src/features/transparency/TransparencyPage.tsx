// Page publique `#/transparency` : chiffres du fonds ouvert, lus en direct sur le ledger par l'API.
import { FundFacts } from "../../landing/FundFacts";

export function TransparencyPage() {
  return (
    <main className="app">
      <div className="section-head">
        <span className="kicker">Transparency</span>
        <h1>Every loan, in the open.</h1>
        <p className="lead">The fund's vault, its loans and their proofs live on the XRP Ledger. Anyone can check them.</p>
      </div>
      <FundFacts />
    </main>
  );
}
