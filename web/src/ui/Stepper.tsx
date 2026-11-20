// Liste ordonnée des étapes d'onboarding avec leur état.
export type StepState = "done" | "current" | "pending";

interface StepperProps {
  steps: readonly { label: string; state: StepState }[];
}

export function Stepper({ steps }: StepperProps) {
  return (
    <ol className="stepper" data-testid="onboarding-steps">
      {steps.map((step, index) => (
        <li key={step.label} className={`stepper-item ${step.state}`} aria-current={step.state === "current" ? "step" : undefined}>
          <span className="step-index">{step.state === "done" ? "■" : `0${index + 1}`}</span>
          {step.label}
        </li>
      ))}
    </ol>
  );
}
