// Parité du témoin calculé dans le navigateur avec celui de src/ (fixture généré par `npm run fixtures`).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import type { AttestedInvoiceFile, PublicDebtor } from "../../../../src/api/contract";
import { buildCircuitInput, debtorTree, invoiceNullifier, merklePathOf, provenThreshold } from "./witness";

interface WitnessFixture {
  debtors: PublicDebtor[];
  debtorPaths: { name: string; root: string; pathElements: string[]; pathIndices: number[] }[];
  file: AttestedInvoiceFile;
  threshold: string;
  vintage: string;
  blinding: string;
  circuitInput: Record<string, string | string[]>;
  nullifier: string;
}

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/witness.json", import.meta.url), "utf8"),
) as WitnessFixture;

/** Paliers publics de l'offre, en centimes, tels que servis par `GET /api/proof/params`. */
const TIERS_CENTS = ["500000", "1000000", "2000000", "5000000", "10000000"];

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
      /not on Atlas's verified list/,
    );
  });

  test("l'empreinte N calculée dans le navigateur est celle du back", () => {
    assert.equal(invoiceNullifier(fixture.file.attestation.uuid), fixture.nullifier);
  });
});

describe("palier prouvé choisi dans le navigateur", () => {
  const cases: [string, string, bigint | undefined][] = [
    ["10 340 $", "1034000", 1_000_000n],
    ["4 999 $", "499900", undefined],
    ["5 000 $", "500000", 500_000n],
    ["100 000 $", "10000000", 10_000_000n],
    ["250 000 $", "25000000", 10_000_000n],
  ];
  for (const [label, amountCents, expected] of cases) {
    test(`une facture de ${label} est prouvée au plus grand palier qui ne la dépasse pas`, () => {
      assert.equal(provenThreshold(amountCents, TIERS_CENTS), expected);
    });
  }

  test("l'ordre des paliers reçus ne change pas le choix", () => {
    assert.equal(provenThreshold("2345000", [...TIERS_CENTS].reverse()), 2_000_000n);
  });
});
