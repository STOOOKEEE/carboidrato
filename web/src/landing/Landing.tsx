import { InvoiceChecker } from "../components/InvoiceChecker";
import { Nav } from "../components/Nav";
import { Hero } from "./Hero";
import { HowItWorks } from "./HowItWorks";

export function Landing() {
  return (
    <div className="page">
      <Nav />
      <main>
        <Hero />
        <section id="simulate" className="section">
          <div className="section-head">
            <span className="kicker">Simulation</span>
            <h2>
              How much can we <span className="underline">advance you</span>?
            </h2>
          </div>
          <InvoiceChecker />
        </section>
        <HowItWorks />
      </main>
      <footer className="footer">
        <span>bari · IXH26 · Track 3</span>
        <span>Running on XRPL devnet</span>
      </footer>
    </div>
  );
}
