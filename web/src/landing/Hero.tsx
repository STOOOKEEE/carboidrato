import type { MouseEvent } from "react";
import { AtlasFigure } from "./AtlasFigure";
import { FundFacts } from "./FundFacts";

const DOORS_ID = "doors";

/** Défilement vers les portes sans toucher au hash (le routeur remonterait en haut de page). */
function scrollToDoors(event: MouseEvent<HTMLAnchorElement>) {
  event.preventDefault();
  document.getElementById(DOORS_ID)?.scrollIntoView({ behavior: "smooth" });
}

export function Hero() {
  return (
    <section className="hero">
      <div className="hero-copy">
        <span className="kicker">Invoice financing on XRPL — 001</span>
        <h1>
          Your invoice is worth cash. <span className="underline">Today.</span>
        </h1>
        <p className="lead">
          Waiting months for a client to pay drains a supplier's cash. On Bari, the client confirms the invoice, the
          supplier gets 90% of it in seconds, and verified lenders fund it from a vault on the XRP Ledger. The invoice
          itself never leaves their two browsers.
        </p>
        <a className="cta" href={`#${DOORS_ID}`} onClick={scrollToDoors}>
          Explore <span aria-hidden="true">↗</span>
        </a>
        <FundFacts />
      </div>
      <AtlasFigure />
    </section>
  );
}
