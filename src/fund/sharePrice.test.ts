// Prix de la part, valeur d'une position, rendement variable et cotations immédiates plafonnées par Bari.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  SHARE_DISPLAY_UNITS,
  entryShares,
  exitPayout,
  immediateLimits,
  perDisplayShare,
  positionValue,
  sharePrice,
  variableYieldTenthBips,
} from "./sharePrice.js";

const USD = 1_000_000n;

describe("sharePrice", () => {
  test("(AssetsTotal − LossUnrealized) / parts en circulation, en rationnel exact", () => {
    const price = sharePrice({ assetsTotal: 103_000n * USD, lossUnrealized: 1_000n * USD, sharesOutstanding: 100_000n * USD });
    assert.deepEqual(price, { assets: 102_000n * USD, shares: 100_000n * USD });
    assert.equal(perDisplayShare(price.assets, price.shares), 1_020_000n);
  });

  test("Vault vide : une part au pair (une unité de part pour une unité de RLUSD)", () => {
    const price = sharePrice({ assetsTotal: 0n, lossUnrealized: 0n, sharesOutstanding: 0n });
    assert.equal(perDisplayShare(price.assets, price.shares), SHARE_DISPLAY_UNITS);
    assert.equal(positionValue(price, 5n * USD), 5n * USD);
  });

  test("valeur d'une position arrondie à l'unité inférieure", () => {
    const price = { assets: 10n, shares: 3n };
    assert.equal(positionValue(price, 1n), 3n);
    assert.equal(positionValue(price, 3n), 10n);
  });
});

describe("cotations immédiates", () => {
  const price = { assets: 102n, shares: 100n };

  test("entrée : RLUSD → parts au prix de la part, arrondi en faveur du fonds", () => {
    assert.equal(entryShares(price, 1_020n), 1_000n);
    assert.equal(entryShares(price, 1_021n), 1_000n);
  });

  test("sortie : parts → RLUSD au prix de la part −0,5 %", () => {
    assert.equal(exitPayout(price, 1_000n), 1_014n);
    assert.equal(exitPayout(price, 100n * USD), 101_490_000n);
  });

  test("plafonds : stock de parts de Bari à l'entrée, réserve RLUSD de Bari à la sortie", () => {
    const limits = immediateLimits(price, { shareStock: 1_000n, reserve: 1_014n });
    assert.equal(limits.maxEntryAmount, 1_020n);
    assert.ok(entryShares(price, limits.maxEntryAmount) <= 1_000n);
    assert.ok(exitPayout(price, limits.maxExitShares) <= 1_014n);
    assert.ok(exitPayout(price, limits.maxExitShares + 1n) > 1_014n);
  });

  test("plafond de sortie exact sur des montants quelconques", () => {
    for (const [assets, shares, reserve] of [
      [123_456_789n, 120_000_000n, 5_000_000n],
      [1n, 1n, 0n],
      [7n, 3n, 999n],
    ]) {
      const quoted = { assets, shares };
      const { maxExitShares } = immediateLimits(quoted, { shareStock: 0n, reserve });
      assert.ok(exitPayout(quoted, maxExitShares) <= reserve);
      assert.ok(exitPayout(quoted, maxExitShares + 1n) > reserve);
    }
  });

  test("sans stock ni réserve, rien ne passe", () => {
    assert.deepEqual(immediateLimits(price, { shareStock: 0n, reserve: 0n }), { maxEntryAmount: 0n, maxExitShares: 0n });
  });
});

describe("variableYieldTenthBips", () => {
  test("Σ principal × taux × (1 − frais de gestion) / AssetsTotal, en dixièmes de point de base", () => {
    // 9 000 $ à 6 %, frais 1 % → 534,6 $ par an sur 100 000 $ d'actifs = 0,5346 %.
    const loans = [{ principalOutstanding: 9_000n * USD, interestRate: 6_000 }];
    assert.equal(variableYieldTenthBips(loans, 1_000, 100_000n * USD), 534);
  });

  test("plusieurs prêts, prêts soldés ignorés", () => {
    const loans = [
      { principalOutstanding: 9_000n * USD, interestRate: 6_000 },
      { principalOutstanding: 18_000n * USD, interestRate: 8_000 },
      { principalOutstanding: 0n, interestRate: 9_000 },
    ];
    // (9 000 × 6 % + 18 000 × 8 %) × 99 % / 100 000 = 1,9602 %.
    assert.equal(variableYieldTenthBips(loans, 1_000, 100_000n * USD), 1_960);
  });

  test("fonds vide ou sans prêt : 0", () => {
    assert.equal(variableYieldTenthBips([], 1_000, 100n * USD), 0);
    assert.equal(variableYieldTenthBips([{ principalOutstanding: USD, interestRate: 6_000 }], 1_000, 0n), 0);
  });
});
