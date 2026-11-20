// Dernier pré-contrôle, gardé le temps de la session pour passer de la landing à l'app.

import type { PrecheckResponse } from "../../src/api/contract";

const STORAGE_KEY = "bari.precheck";

export function savePrecheck(result: PrecheckResponse): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(result));
}

export function loadPrecheck(): PrecheckResponse | undefined {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (raw === null) return undefined;
  const parsed: unknown = JSON.parse(raw);
  const looksValid = typeof parsed === "object" && parsed !== null && "verdict" in parsed && "kyb" in parsed;
  return looksValid ? (parsed as PrecheckResponse) : undefined;
}
