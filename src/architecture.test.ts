// Carte des composants (docs/ARCHITECTURE.md), vérifiée à chaque `npm test` : un composant est un dossier de src/,
// et il n'importe que des composants de couches strictement inférieures, ce qui exclut tout cycle.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

/** Couche de chaque composant : un import n'est permis que vers une couche strictement inférieure. */
const LAYERS: Readonly<Record<string, number>> = {
  config: 0,
  lib: 1,
  zk: 2,
  xrpl: 2,
  accounts: 3,
  invoice: 4,
  kyb: 4,
  fund: 5,
  lending: 6,
  audit: 7,
  setup: 7,
  api: 8,
  demo: 9,
};

/** Seul fichier du back que le front a le droit d'importer : les types partagés de l'API. */
const WEB_CONTRACT = path.join("src", "api", "contract");

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const RELATIVE_IMPORT = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)["'](\.{1,2}\/[^"']+)["']/g;

interface ImportEdge {
  from: string;
  to: string;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(path.join(ROOT, directory), { recursive: true, encoding: "utf8" })
    .filter((file) => /\.tsx?$/.test(file) && !file.endsWith(".d.ts"))
    .map((file) => path.join(directory, file));
}

/** Imports relatifs d'un fichier, cibles ramenées à un chemin depuis la racine du dépôt, sans extension. */
function relativeImports(file: string): ImportEdge[] {
  const text = readFileSync(path.join(ROOT, file), "utf8");
  return [...text.matchAll(RELATIVE_IMPORT)].map(([, specifier]) => ({
    from: file,
    to: path.join(path.dirname(file), specifier).replace(/\.(js|ts|tsx)$/, ""),
  }));
}

/** Premier dossier sous src/ ; undefined pour un fichier posé à la racine de src/. */
function componentOf(file: string): string | undefined {
  const [top, name, ...rest] = file.split(path.sep);
  return top === "src" && rest.length > 0 ? name : undefined;
}

describe("carte des composants", () => {
  const backendFiles = sourceFiles("src");

  test("chaque dossier de src/ figure dans la carte", () => {
    const components = new Set(backendFiles.map(componentOf).filter((name) => name !== undefined));
    const unmapped = [...components].filter((name) => !(name in LAYERS));
    assert.deepEqual(unmapped, [], "à ajouter dans LAYERS et dans docs/ARCHITECTURE.md");
  });

  test("un composant n'importe que des couches inférieures", () => {
    const violations = backendFiles.flatMap(relativeImports).flatMap(({ from, to }) => {
      const source = componentOf(from);
      const target = componentOf(to);
      if (source === undefined || target === undefined || source === target) return [];
      if (LAYERS[target] < LAYERS[source]) return [];
      return [`${from} → ${to} (${source}:${LAYERS[source]} → ${target}:${LAYERS[target]})`];
    });
    assert.deepEqual(violations, []);
  });

  test("le front n'importe du back que le contrat de l'API", () => {
    const violations = sourceFiles(path.join("web", "src"))
      .flatMap(relativeImports)
      .filter(({ to }) => to.startsWith(`src${path.sep}`) && to !== WEB_CONTRACT)
      .map(({ from, to }) => `${from} → ${to}`);
    assert.deepEqual(violations, []);
  });
});
