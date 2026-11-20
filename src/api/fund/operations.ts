// Exécution des opérations qui signent des transactions : une seule à la fois (les comptes de démo sont partagés,
// et leurs séquences ne supportent pas deux soumissions concurrentes). Les transactions de l'opération sont
// collectées pour être renvoyées dans la réponse HTTP.

import type { EventHub, TxSummary } from "./events.js";

export interface OperationOutcome<T> {
  result: T;
  transactions: TxSummary[];
}

/** Erreur d'une opération, avec les transactions déjà soumises avant l'échec. */
export class OperationFailed extends Error {
  constructor(
    readonly original: unknown,
    readonly transactions: TxSummary[],
  ) {
    super(original instanceof Error ? original.message : String(original));
  }
}

export class OperationQueue {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly events: EventHub) {}

  run<T>(name: string, operation: () => Promise<T>): Promise<OperationOutcome<T>> {
    const next = this.tail.then(() => this.execute(name, operation));
    // La file continue même si cette opération échoue : l'erreur est rendue à l'appelant seul.
    this.tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async execute<T>(name: string, operation: () => Promise<T>): Promise<OperationOutcome<T>> {
    const transactions: TxSummary[] = [];
    const stopCollecting = this.events.subscribe((event) => {
      if (event.type === "tx") {
        transactions.push({ label: event.label, hash: event.hash, result: event.result, explorerUrl: event.explorerUrl });
      }
    });
    this.events.publish({ type: "operation", name, status: "started" });
    try {
      const result = await operation();
      this.events.publish({ type: "operation", name, status: "succeeded" });
      return { result, transactions };
    } catch (error) {
      this.events.publish({
        type: "operation",
        name,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      throw new OperationFailed(error, transactions);
    } finally {
      stopCollecting();
    }
  }
}
