// Écran « Verifying… » : transactions d'ouverture du compte, en attente puis validées avec leur lien.
import { TxLink } from "../../ui/TxLink";
import type { VerificationStep } from "./account.machine";

export function VerificationSteps({ steps }: { steps: VerificationStep[] }) {
  return (
    <ol className="verify-steps" data-testid="verification-steps">
      {steps.map((step, index) => (
        <li key={step.label} className={step.done ? "done" : "pending"}>
          <span className="step-index">{step.done ? "■" : `0${index + 1}`}</span>
          <span>{step.label}</span>
          {step.hash !== undefined && <TxLink hash={step.hash} />}
        </li>
      ))}
    </ol>
  );
}
