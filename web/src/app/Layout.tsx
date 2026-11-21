// Gabarit commun des pages : fond tramé, navigation, contenu, pied de page.
import type { ReactNode } from "react";
import { TRANSPARENCY_ROUTE } from "../routes";
import { ShaderBackground } from "../ui/ShaderBackground";
import { Nav } from "./Nav";

export function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="page-shader" aria-hidden="true">
        <ShaderBackground />
      </div>
      <div className="page">
        <Nav />
        {children}
        <footer className="footer">
          <span>bari · invoice financing on the XRP Ledger</span>
          <a href={TRANSPARENCY_ROUTE}>Every loan, re-verifiable →</a>
        </footer>
      </div>
    </>
  );
}
