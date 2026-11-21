import type { MouseEvent } from "react";
import { FundFacts } from "./FundFacts";
import { SakuraBranch } from "./SakuraBranch";

const DOORS_ID = "doors";

/** Défilement vers les portes sans toucher au hash (le routeur remonterait en haut de page). */
function scrollToDoors(event: MouseEvent<HTMLAnchorElement>) {
  event.preventDefault();
  document.getElementById(DOORS_ID)?.scrollIntoView({ behavior: "smooth" });
}

export function Hero() {
  return (
    <section className="hero">
      <SakuraBranch variant="hanging" className="hero-sakura" />
      <div className="hero-copy">
        <span className="kicker">Invoice financing on XRPL — 001</span>
        <h1>
          Your invoice is worth cash. <span className="underline">Today.</span>
        </h1>
        <p className="lead">
          Italian public bodies take months to pay their suppliers. On Bari, the public body confirms the invoice, the
          supplier gets 90% of it in seconds, and verified lenders fund it from a vault on the XRP Ledger. The invoice
          itself never leaves their two browsers.
        </p>
        <a className="cta" href={`#${DOORS_ID}`} onClick={scrollToDoors}>
          Explore <span aria-hidden="true">↗</span>
        </a>
        <FundFacts />
      </div>
      <div className="hero-foot">
        <a href={`#${DOORS_ID}`} onClick={scrollToDoors}>
          Scroll to discover
        </a>
        <span>01 / 03</span>
      </div>
    </section>
  );
}
