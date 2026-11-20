// Bouton partagé : action principale marquée, raison visible obligatoire si désactivé.
import { useId, type ButtonHTMLAttributes } from "react";

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "disabled"> & {
  primary?: boolean;
  variant?: "solid" | "ghost";
} & ({ disabled?: false; reason?: never } | { disabled: boolean; reason: string });

export function Button({ primary, variant = "solid", disabled, reason, className, type = "button", children, ...rest }: ButtonProps) {
  const reasonId = useId();
  // Si le libellé exprime déjà la raison, on ne la répète pas.
  const showReason = disabled === true && reason !== undefined && reason !== children;
  const classes = ["button", variant === "ghost" ? "button-ghost" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <>
      <button
        {...rest}
        type={type}
        className={classes}
        disabled={disabled}
        data-primary={primary ? "" : undefined}
        aria-describedby={showReason ? reasonId : rest["aria-describedby"]}
        title={disabled === true ? reason : rest.title}
      >
        {children}
      </button>
      {showReason && (
        <p id={reasonId} className="muted button-reason">
          {reason}
        </p>
      )}
    </>
  );
}
