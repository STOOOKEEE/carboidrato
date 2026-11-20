import { useEffect, useState } from "react";
import { DitherCanvas } from "../dither/DitherCanvas";
import type { ShapeName } from "../dither/shapes";
import { APP_ROUTE } from "../routes";

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
          Waiting 90 days for a city hall to pay? Drop the invoice your client attested. In seconds we check it's genuine
          and never financed, and tell you how much we advance.
        </p>
        <div className="hero-actions">
          <a className="button" href="#simulate">
            Simulate my invoice
          </a>
          <a className="button button-ghost" href={APP_ROUTE}>
            Open app
          </a>
        </div>
        <ul className="hero-facts">
          <li>
            <strong>90%</strong> advanced
          </li>
          <li>
            <strong>6%</strong> a year
          </li>
          <li>
            <strong>0</strong> client names on-chain
          </li>
        </ul>
      </div>
      <DitherCanvas shape={frame.shape} scanning={frame.scanning} interactive cell={9} className="hero-canvas" />
    </section>
  );
}
