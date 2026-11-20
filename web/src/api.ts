// Appels à l'API Bari (proxifiée par Vite vers `npm run api`).

import type { KybRequest, KybResponse, PrecheckResponse } from "../../src/api/contract";
import { parseJsonOrUndefined } from "./json";

function errorMessage(payload: unknown, status: number): string {
  if (typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string") {
    return payload.error;
  }
  return `Bari API unavailable (HTTP ${status}). Is \`npm run api\` running?`;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = parseJsonOrUndefined(await response.text());
  if (!response.ok || payload === undefined) throw new Error(errorMessage(payload, response.status));
  return payload as T;
}

export const checkInvoice = (invoice: unknown) => postJson<PrecheckResponse>("/api/check", invoice);

export const submitKyb = (request: KybRequest) => postJson<KybResponse>("/api/kyb", request);
