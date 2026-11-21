import assert from "node:assert/strict";
import { test } from "node:test";
import { goldenSpiral, PHI } from "./goldenSpiral";

test("la spirale part du coin bas gauche et compte un arc par carré", () => {
  const spiral = goldenSpiral(1000, 8);
  assert.match(spiral.path, /^M0 1000A1000 1000 0 0 1 1000 0/);
  assert.equal(spiral.path.split("A").length - 1, 8);
});

test("chaque coupe retire un carré : le rectangle restant reste un rectangle d'or", () => {
  const spiral = goldenSpiral(1000, 4);
  // Bords (4) puis une coupe par carré.
  assert.equal(spiral.lines.length, 8);
  // Première coupe verticale à x = hauteur, deuxième horizontale à y = largeur restante.
  assert.deepEqual(spiral.lines[4], [1000, 0, 1000, 1000]);
  const rest = 1000 * PHI - 1000;
  assert.deepEqual(spiral.lines[5], [1000, Math.round(rest * 100) / 100, Math.round(1000 * PHI * 100) / 100, Math.round(rest * 100) / 100]);
});
