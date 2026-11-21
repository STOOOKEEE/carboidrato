// Formulaire d'un ordre du prêteur (dépôt ou retrait) : montant, aperçu calculé dans la page, envoi et son état.
import { useState, type SubmitEvent } from "react";
import { Button } from "../../ui/Button";
import { Facts, type Fact } from "../../ui/Facts";
import { Field } from "../../ui/Field";
import { isBusy, type Operation, type TradeCheck, type TradePreview } from "./lend.machine";
import { OperationStatus } from "./OperationStatus";

const BUSY_REASON = "One transaction at a time: wait for the current one to finish.";

interface TradeFormProps {
  action: "deposit" | "withdraw";
  title: string;
  explanation: string;
  label: string;
  hint: string;
  check: (input: string) => TradeCheck;
  previewFacts: (preview: TradePreview) => Fact[];
  submitLabel: string;
  pendingLabel: string;
  primary?: boolean;
  /** Remplit le champ d'un coup (toutes les parts). */
  fill?: { label: string; value: string };
  operation: Operation;
  /** Résout `true` si l'ordre est passé : le champ se vide. */
  onSubmit: (amount: bigint) => Promise<boolean>;
}

export function TradeForm(props: TradeFormProps) {
  const { action, operation, fill } = props;
  const [input, setInput] = useState("");
  const [attempted, setAttempted] = useState(false);
  const check = props.check(input);
  const busy = isBusy(operation);
  const mine = busy && operation.action === action;
  const pending = operation.status === "signing" ? "Sign in Otsu…" : props.pendingLabel;
  const error = !check.ok && (input !== "" || attempted) ? check.error : undefined;

  const edit = (value: string) => {
    setInput(value);
    setAttempted(false);
  };

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (!check.ok || busy) return;
    void props.onSubmit(check.amount).then((placed) => {
      if (placed) edit("");
    });
  };

  return (
    <section className="step" data-testid={`lend-${action}`}>
      <h2>{props.title}</h2>
      <p className="muted">{props.explanation}</p>
      <form className="form" onSubmit={submit} noValidate>
        <Field label={props.label} error={error} hint={props.hint}>
          <input
            inputMode="decimal"
            autoComplete="off"
            value={input}
            onChange={(event) => edit(event.target.value)}
            disabled={mine}
          />
        </Field>
        {fill !== undefined && (
          <Button variant="ghost" className="lend-fill" onClick={() => edit(fill.value)}>
            {fill.label}
          </Button>
        )}
        {check.ok && <Facts facts={props.previewFacts(check.preview)} />}
        {error === undefined && !check.ok && <p className="muted small">Type an amount to preview what you get.</p>}
        <Button
          type="submit"
          primary={props.primary}
          variant={props.primary ? "solid" : "ghost"}
          disabled={busy}
          reason={mine ? pending : BUSY_REASON}
        >
          {mine ? pending : props.submitLabel}
        </Button>
      </form>
      <OperationStatus operation={operation} action={action} />
    </section>
  );
}
