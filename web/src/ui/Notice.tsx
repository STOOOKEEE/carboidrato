// Message d'information ou d'erreur annoncé aux lecteurs d'écran.
import type { ReactNode } from "react";

interface NoticeProps {
  kind: "info" | "error";
  children: ReactNode;
}

export function Notice({ kind, children }: NoticeProps) {
  return kind === "error" ? (
    <p className="error" role="alert">
      {children}
    </p>
  ) : (
    <p className="muted" role="status">
      {children}
    </p>
  );
}
