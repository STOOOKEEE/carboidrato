// Zone de dépôt d'un fichier (glisser ou parcourir) avec la trame à gauche et un panneau à droite.
import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { DitherCanvas } from "../dither/DitherCanvas";
import type { ShapeName } from "../dither/shapes";

const BUSY_CAPTION = "Working…";

interface DropZoneProps {
  onFile: (file: File) => void;
  /** Libellé accessible du bouton de choix de fichier. */
  label: string;
  /** Légende sous la trame au repos. */
  caption: string;
  busy?: boolean;
  shape?: ShapeName;
  danger?: boolean;
  accept?: string;
  children: ReactNode;
}

export function DropZone({ onFile, label, caption, busy = false, shape = "upload", danger = false, accept, children }: DropZoneProps) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const onDragOver = (event: DragEvent) => {
    event.preventDefault();
    if (!busy) setDragging(true);
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file !== undefined && !busy) onFile(file);
  };

  return (
    <div
      className={`checker${dragging ? " is-dragging" : ""}`}
      onDragOver={onDragOver}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <button
        type="button"
        className="checker-visual"
        onClick={() => inputRef.current?.click()}
        aria-label={label}
        disabled={busy}
        // Désactivé pendant le travail : la légende visible en est la raison, reprise en titre comme dans Button.
        title={busy ? BUSY_CAPTION : undefined}
      >
        <DitherCanvas
          shape={dragging ? "invoice" : shape}
          scanning={busy}
          interactive
          cell={8}
          tone={danger ? "danger" : "light"}
          className="checker-canvas"
        />
        <span className="checker-caption">{dragging ? "Release to drop" : busy ? BUSY_CAPTION : caption}</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        hidden
        accept={accept}
        data-testid="drop-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) onFile(file);
          event.target.value = "";
        }}
      />
      <div className="checker-panel" aria-live="polite">
        {children}
      </div>
    </div>
  );
}
