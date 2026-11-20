// Parité du témoin calculé dans le navigateur avec celui de src/ (fixture généré par `npm run fixtures`).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import type { AttestedInvoiceFile, PublicDebtor } from "../../../../src/api/contract";
import { buildCircuitInput, debtorTree, merklePathOf } from "./witness";

interface WitnessFixture {
  debtors: PublicDebtor[];
  debtorPaths: { name: string; root: string; pathElements: string[]; pathIndices: number[] }[];
  file: AttestedInvoiceFile;
  threshold: string;
  vintage: string;
  blinding: string;
  circuitInput: Record<string, string | string[]>;
}

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/witness.json", import.meta.url), "utf8"),
) as WitnessFixture;

describe("témoin construit dans le navigateur", () => {
  test("la racine et chaque chemin de Merkle sont ceux de src/zk", () => {
    const tree = debtorTree(fixture.debtors);
    for (const expected of fixture.debtorPaths) {
      const debtor = fixture.debtors.find(({ name }) => name === expected.name);
      assert.ok(debtor);
      const path = merklePathOf(tree, debtor.publicKey);
      assert.equal(tree.root.toString(), expected.root);
      assert.deepEqual(path.pathElements.map(String), expected.pathElements);
      assert.deepEqual(path.pathIndices, expected.pathIndices);
    }
  });

  test("l'entrée du circuit est identique à celle du back", () => {
    const input = buildCircuitInput({
      file: fixture.file,
      debtors: fixture.debtors,
      threshold: BigInt(fixture.threshold),
      vintage: BigInt(fixture.vintage),
      blinding: BigInt(fixture.blinding),
    });
    assert.deepEqual(input, fixture.circuitInput);
  });

  test("un débiteur hors de la liste publique rend le témoin impossible", () => {
    const [, ...others] = fixture.debtors;
    assert.throws(
      () =>
        buildCircuitInput({
          file: fixture.file,
          debtors: others,
          threshold: BigInt(fixture.threshold),
          vintage: BigInt(fixture.vintage),
          blinding: BigInt(fixture.blinding),
        }),
      /not on Bari's verified list/,
    );
  });
});
