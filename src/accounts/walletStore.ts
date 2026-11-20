// Stockage local (fichier gitignoré) des seeds de test. Les seeds ne sont jamais affichées.

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const FILE_MODE_OWNER_ONLY = 0o600;

export type SeedMap = Record<string, string>;

function isSeedMap(value: unknown): value is SeedMap {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every((seed) => typeof seed === "string")
  );
}

export function loadSeeds(file: string): SeedMap {
  if (!existsSync(file)) return {};
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!isSeedMap(parsed)) {
    throw new Error(`Format inattendu dans ${file} (objet { nom: seed } attendu)`);
  }
  return parsed;
}

export function saveSeeds(file: string, seeds: SeedMap): void {
  writeFileSync(file, `${JSON.stringify(seeds, null, 2)}\n`, { mode: FILE_MODE_OWNER_ONLY });
}
