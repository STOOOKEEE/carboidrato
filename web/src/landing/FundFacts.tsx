// Chiffres clés du fonds ouvert, lus en direct de l'API (landing et Transparency).
import { useEffect, useState } from "react";
import { fetchFund } from "../api";
import { fundFigures, type FundFigure } from "./fundFigures";

type FundFactsState = { status: "loading" } | { status: "ready"; figures: FundFigure[] } | { status: "unavailable" };

export function FundFacts() {
  const [state, setState] = useState<FundFactsState>({ status: "loading" });
  useEffect(() => {
    fetchFund()
      .then((fund) => setState({ status: "ready", figures: fundFigures(fund) }))
      .catch(() => setState({ status: "unavailable" }));
  }, []);

  if (state.status === "unavailable") {
    return <p className="muted small">The fund's figures are unavailable right now: Bari's server is not answering.</p>;
  }
  return (
    <ul className="hero-facts" data-testid="fund-facts" aria-busy={state.status === "loading"}>
      {state.status === "loading"
        ? ["in the fund", "invoices financed", "lending until"].map((label) => (
            <li key={label}>
              <strong>—</strong> {label}
            </li>
          ))
        : state.figures.map((figure) => (
            <li key={figure.label}>
              <strong>{figure.value}</strong> {figure.label}
            </li>
          ))}
    </ul>
  );
}
