import { useEffect, useState } from "react";
import { DitherCanvas } from "../dither/DitherCanvas";
import type { ShapeName } from "../dither/shapes";
import { FundFacts } from "./FundFacts";

/** Boucle du héros : la facture est scannée, puis devient du cash. */
const HERO_LOOP: { shape: ShapeName; scanning: boolean; durationMs: number }[] = [
  { shape: "invoice", scanning: false, durationMs: 2200 },
  { shape: "invoice", scanning: true, durationMs: 2600 },
  { shape: "euro", scanning: false, durationMs: 3200 },
];

function useLoop() {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => setIndex((current) => (current + 1) % HERO_LOOP.length), HERO_LOOP[index].durationMs);
    return () => clearTimeout(timer);
  }, [index]);
  return HERO_LOOP[index];
}

export function Hero() {
  const frame = useLoop();
  return (
    <section className="hero">
      <div className="hero-copy">
        <span className="kicker">Invoice financing on XRPL</span>
        <h1>
          Your invoice is worth cash. <span className="underline">Today.</span>
        </h1>
        <p className="lead">
          Italian public bodies take months to pay their suppliers. On Bari, the public body confirms the invoice, the
          supplier gets 90% of it in seconds, and verified lenders fund it from a vault on the XRP Ledger. The invoice
          itself never leaves their two browsers.
        </p>
        <FundFacts />
      </div>
      <DitherCanvas shape={frame.shape} scanning={frame.scanning} interactive cell={9} className="hero-canvas" />
    </section>
  );
}
