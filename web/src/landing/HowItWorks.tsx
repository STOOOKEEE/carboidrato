import { DitherCanvas } from "../dither/DitherCanvas";
import type { ShapeName } from "../dither/shapes";

const STEPS: { shape: ShapeName; title: string; text: string }[] = [
  {
    shape: "shield",
    title: "Your client attests",
    text: "The city hall signs your invoice once. That signature is the only source of truth: change one digit and it breaks.",
  },
  {
    shape: "invoice",
    title: "We verify without seeing",
    text: "A zero-knowledge proof shows the invoice is real, large enough and from a verified debtor, without revealing it.",
  },
  {
    shape: "euro",
    title: "You get paid",
    text: "Its fingerprint is locked on XRPL so it can never be financed twice. The advance lands in your account.",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="section">
      <div className="section-head">
        <span className="kicker">How it works</span>
        <h2>
          Every invoice carries <span className="underline">its own proof</span>.
        </h2>
      </div>
      <ol className="how-grid">
        {STEPS.map((step, index) => (
          <li key={step.title} className="how-card">
            <DitherCanvas shape={step.shape} cell={6} interactive className="how-canvas" />
            <span className="how-index">0{index + 1}</span>
            <h3>{step.title}</h3>
            <p className="muted">{step.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
