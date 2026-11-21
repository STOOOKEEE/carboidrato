// Champ de formulaire : libellé, contrôle, aide et erreur reliées au contrôle pour les lecteurs d'écran.
import { cloneElement, useId, type ReactElement } from "react";

interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  children: ReactElement<{ id?: string; "aria-invalid"?: boolean; "aria-describedby"?: string }>;
}

export function Field({ label, error, hint, children }: FieldProps) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? hint;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {cloneElement(children, {
        id,
        "aria-invalid": error !== undefined,
        "aria-describedby": note === undefined ? undefined : noteId,
      })}
      {note !== undefined && (
        <p id={noteId} className={error === undefined ? "muted small" : "field-error"}>
          {note}
        </p>
      )}
    </div>
  );
}
