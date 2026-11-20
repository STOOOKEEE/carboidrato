// Panneau d'étape : numéro, titre, explication d'une ligne et action.
import type { ReactNode } from "react";

interface StepCardProps {
  index: number;
  title: string;
  done: boolean;
  explanation?: string;
  children?: ReactNode;
}

export function StepCard({ index, title, done, explanation, children }: StepCardProps) {
  return (
    <section className={done ? "step done" : "step"}>
      <header className="step-head">
        <span className="step-index">{done ? "■" : `0${index}`}</span>
        <h2>{title}</h2>
      </header>
      {explanation !== undefined && <p className="muted">{explanation}</p>}
      {children}
    </section>
  );
}
