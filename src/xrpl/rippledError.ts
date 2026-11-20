import { RippledError } from "xrpl";

/** Code d'erreur rippled (« txnNotFound », « entryNotFound »…) d'une requête échouée, sinon undefined. */
export function rippledErrorCode(error: unknown): string | undefined {
  if (!(error instanceof RippledError)) return undefined;
  const data = error.data;
  if (typeof data !== "object" || data === null || !("error" in data)) return undefined;
  return typeof data.error === "string" ? data.error : undefined;
}
