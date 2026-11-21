// Fin de la landing : une branche monte du coin bas gauche, le mot de la fin et le lien vers Transparency.
import { TRANSPARENCY_ROUTE } from "../routes";
import { SakuraBranch } from "./SakuraBranch";

export function Outro() {
  return (
    <section className="outro">
      <SakuraBranch variant="rising" className="outro-sakura" />
      <div className="outro-copy">
        <span className="kicker">A study in trust — 003</span>
        <h2>
          Where invoices <span className="underline">blossom</span>.
        </h2>
        <p className="muted">Every loan carries its own proof, and anyone can check all of them in a browser.</p>
        <a className="cta" href={TRANSPARENCY_ROUTE}>
          Verify every loan <span aria-hidden="true">↗</span>
        </a>
      </div>
    </section>
  );
}
