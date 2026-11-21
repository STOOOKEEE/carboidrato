// Les trois portes de Bari, une ligne par acteur, puis le lien vers Transparency.
import { spaceRoute, TRANSPARENCY_ROUTE } from "../routes";

const DOORS = [
  {
    title: "Lend",
    text: "Deposit RLUSD into a vault that only finances invoices confirmed by public bodies. Your shares are a token on the XRP Ledger: exit anytime.",
    action: "Start lending",
    href: spaceRoute("lender"),
  },
  {
    title: "I'm a public body",
    text: "Confirm a supplier's invoice in your browser. It costs you nothing, and your suppliers get paid now instead of in months.",
    action: "Confirm an invoice",
    href: spaceRoute("public_body"),
  },
  {
    title: "I'm owed an invoice",
    text: "Drop the file your client signed and receive 90% of the invoice in seconds. Lenders learn that it covers the advance, never what it says.",
    action: "Get paid now",
    href: spaceRoute("business"),
  },
];

export function Doors() {
  return (
    <section id="doors" className="section">
      <div className="section-head">
        <span className="kicker">Three doors, one fund — 002</span>
        <h2>
          Who are you <span className="underline">today</span>?
        </h2>
      </div>
      <ol className="doors">
        {DOORS.map((door, index) => (
          <li key={door.title} className="door">
            <span className="step-index">0{index + 1}</span>
            <div className="door-copy">
              <h3>{door.title}</h3>
              <p className="muted">{door.text}</p>
            </div>
            <a className="cta" href={door.href}>
              {door.action} <span aria-hidden="true">↗</span>
            </a>
          </li>
        ))}
      </ol>
      <p className="doors-transparency">
        Don't take our word for it: every proof behind every loan is re-verified in your browser.{" "}
        <a className="link" href={TRANSPARENCY_ROUTE}>
          Open Transparency →
        </a>
      </p>
    </section>
  );
}
