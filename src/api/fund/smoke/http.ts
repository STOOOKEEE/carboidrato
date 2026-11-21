// Client HTTP minimal du smoke test : appel JSON avec statut attendu, cookie de session gardé comme le ferait le
// navigateur, et journal des réponses (exemples pour le front).

import { writeFileSync } from "node:fs";

export interface RecordedCall {
  method: string;
  path: string;
  status: number;
  body: unknown;
}

export class ApiClient {
  readonly calls: RecordedCall[] = [];
  private sessionCookie: string | undefined;

  constructor(readonly baseUrl: string) {}

  async call(method: "GET" | "POST", path: string, body?: unknown, expectedStatus: number[] = [200, 201]): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(this.sessionCookie === undefined ? {} : { Cookie: this.sessionCookie }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie !== null) this.sessionCookie = setCookie.split(";")[0];
    const parsed: unknown = await response.json();
    this.calls.push({ method, path, status: response.status, body: parsed });
    if (!expectedStatus.includes(response.status)) {
      throw new Error(`${method} ${path} : statut ${response.status} (attendu ${expectedStatus.join("/")}) ${JSON.stringify(parsed)}`);
    }
    return parsed;
  }

  async bytes(path: string): Promise<Uint8Array> {
    const response = await fetch(`${this.baseUrl}${path}`);
    if (!response.ok) throw new Error(`GET ${path} : statut ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  dump(file: string): void {
    writeFileSync(file, `${JSON.stringify(this.calls, null, 2)}\n`);
  }
}

/** Accès typé à un champ d'une réponse JSON inconnue. */
export function field(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || !(key in value)) throw new Error(`Champ « ${key} » absent de la réponse`);
  return (value as Record<string, unknown>)[key];
}

export function stringField(value: unknown, key: string): string {
  const result = field(value, key);
  if (typeof result !== "string") throw new Error(`Champ « ${key} » : chaîne attendue`);
  return result;
}
