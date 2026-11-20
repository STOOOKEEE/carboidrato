// Événements diffusés au front (flux SSE) : logs et transactions du logger, et début/fin de chaque opération.

import { onLogEvent, type LogEvent } from "../../lib/logger.js";

export interface TxSummary {
  label: string;
  hash: string;
  result: string;
  explorerUrl: string;
}

export type OperationStatus = "started" | "succeeded" | "failed";

export type ApiEventBody =
  | Exclude<LogEvent, { type: "tx" }>
  | ({ type: "tx" } & TxSummary)
  | { type: "operation"; name: string; status: OperationStatus; error?: string };

export type ApiEvent = ApiEventBody & { id: number; at: string };

export type ApiEventListener = (event: ApiEvent) => void;

export class EventHub {
  private readonly listeners = new Set<ApiEventListener>();
  private nextId = 1;
  private readonly stopLogging: () => void;

  constructor(private readonly explorerUrl: string) {
    this.stopLogging = onLogEvent((event) => this.publish(this.fromLog(event)));
  }

  subscribe(listener: ApiEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(body: ApiEventBody): void {
    const event: ApiEvent = { ...body, id: this.nextId++, at: new Date().toISOString() };
    for (const listener of this.listeners) listener(event);
  }

  transactionUrl(hash: string): string {
    return `${this.explorerUrl}/transactions/${hash}`;
  }

  close(): void {
    this.stopLogging();
    this.listeners.clear();
  }

  private fromLog(event: LogEvent): ApiEventBody {
    return event.type === "tx" ? { ...event, explorerUrl: this.transactionUrl(event.hash) } : event;
  }
}
