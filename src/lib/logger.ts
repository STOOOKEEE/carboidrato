// Petit logger des étapes du scénario de démo. Les événements peuvent aussi être suivis (flux SSE de l'API).

const startedAt = Date.now();

/** Événement émis à chaque appel du logger, en plus de l'affichage console. */
export type LogEvent =
  | { type: "step"; title: string }
  | { type: "info"; message: string }
  | { type: "warn"; message: string }
  | { type: "tx"; label: string; hash: string; result: string };

export type LogListener = (event: LogEvent) => void;

const listeners = new Set<LogListener>();

/** Abonne `listener` aux événements du logger ; renvoie la fonction de désabonnement. */
export function onLogEvent(listener: LogListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(event: LogEvent): void {
  for (const listener of listeners) listener(event);
}

function elapsed(): string {
  return `${((Date.now() - startedAt) / 1000).toFixed(0).padStart(4)}s`;
}

export const log = {
  step(title: string): void {
    console.log(`\n[${elapsed()}] ══ ${title}`);
    emit({ type: "step", title });
  },
  info(message: string): void {
    console.log(`[${elapsed()}]    ${message}`);
    emit({ type: "info", message });
  },
  tx(label: string, hash: string, result: string): void {
    console.log(`[${elapsed()}]    ${label.padEnd(44)} ${result.padEnd(14)} ${hash}`);
    emit({ type: "tx", label, hash, result });
  },
  warn(message: string): void {
    console.warn(`[${elapsed()}] ⚠  ${message}`);
    emit({ type: "warn", message });
  },
  elapsedSeconds(): number {
    return Math.round((Date.now() - startedAt) / 1000);
  },
};
