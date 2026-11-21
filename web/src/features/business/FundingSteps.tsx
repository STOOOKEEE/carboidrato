// Étapes en direct de « Get paid now » : preuve, certificat, contrôles de Bari et prêt, chacune avec son lien.
import { TxLink } from "../../ui/TxLink";
import type { FundingStep } from "./business.machine";
import { CheckList } from "./CheckList";

const INDEX_MARKS: Partial<Record<FundingStep["state"], string>> = { done: "■", failed: "✗" };

export function FundingSteps({ steps }: { steps: FundingStep[] }) {
  return (
    <ol className="verify-steps funding-steps" data-testid="funding-steps">
      {steps.map((step, index) => (
        <li key={step.id} className={step.state} data-step={step.id}>
          <span className="step-index">{INDEX_MARKS[step.state] ?? `0${index + 1}`}</span>
          <div className="funding-step">
            <span className="funding-step-label">
              {step.label}
              {step.state === "current" && "…"}
            </span>
            {step.detail !== undefined && <span className={step.state === "failed" ? "error" : "muted small"}>{step.detail}</span>}
            {step.checks !== undefined && (
              <CheckList
                testId="bari-checks"
                checks={step.checks.map(({ id, label, ok, reason }) => ({ id, label, ok, detail: reason }))}
              />
            )}
          </div>
          {step.hash === undefined ? <span /> : <TxLink hash={step.hash} />}
        </li>
      ))}
    </ol>
  );
}
