// Liste de faits « libellé : valeur » (compte, transaction, offre).
import type { ReactNode } from "react";

export interface Fact {
  label: string;
  value: ReactNode;
}

export function Facts({ facts, className }: { facts: Fact[]; className?: string }) {
  return (
    <dl className={["offer-table", className ?? ""].filter(Boolean).join(" ")}>
      {facts.map(({ label, value }, index) => (
        <div className="offer-row" key={`${index}-${label}`}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
