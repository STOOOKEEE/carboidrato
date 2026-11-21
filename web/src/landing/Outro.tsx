// Fin de la landing : le mot de la fin, le lien vers Transparency et le φ en grand.
import { TRANSPARENCY_ROUTE } from "../routes";

export function Outro() {
  return (
    <section className="outro">
      <div className="outro-copy">
        <span className="kicker">The golden rule — 003</span>
        <h2>
          Every loan carries its <span className="underline">proof</span>.
        </h2>
        <p className="muted">
          No invoice is shown, none can be financed twice, and no debtor weighs more than a fifth of the fund. Check it
          all in your browser.
        </p>
        <a className="cta" href={TRANSPARENCY_ROUTE}>
          Verify every loan <span aria-hidden="true">↗</span>
        </a>
      </div>
      <span className="outro-phi" aria-hidden="true">
        φ
      </span>
    </section>
  );
}
