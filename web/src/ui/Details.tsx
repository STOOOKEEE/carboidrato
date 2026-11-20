// Données techniques repliées par défaut.
import type { ReactNode } from "react";

interface DetailsProps {
  summary?: string;
  children: ReactNode;
}

export function Details({ summary = "details", children }: DetailsProps) {
  return (
    <details className="details">
      <summary>{summary}</summary>
      {children}
    </details>
  );
}
