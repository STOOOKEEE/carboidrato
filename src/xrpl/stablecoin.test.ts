// RLUSD en ligne de confiance : unités entières (10^-6) ↔ valeur décimale du ledger, montants et transactions construits.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Wallet } from "xrpl";
import {
  RLUSD_CURRENCY,
  currencyLabel,
  stablecoinAmount,
  stablecoinPayment,
  trustLine,
  unitsToValue,
  valueToUnits,
  type Stablecoin,
} from "./stablecoin.js";

const RLUSD: Stablecoin = { currency: RLUSD_CURRENCY, issuer: Wallet.generate().address };

describe("unités ↔ valeur du ledger", () => {
  test("unités → valeur décimale sans zéros inutiles", () => {
    assert.equal(unitsToValue(9_000_000_000n), "9000");
    assert.equal(unitsToValue(8_955_500_000n), "8955.5");
    assert.equal(unitsToValue(45_000_000n), "45");
    assert.equal(unitsToValue(1n), "0.000001");
    assert.equal(unitsToValue(0n), "0");
  });

  test("valeur décimale → unités", () => {
    assert.equal(valueToUnits("9000"), 9_000_000_000n);
    assert.equal(valueToUnits("8955.5"), 8_955_500_000n);
    assert.equal(valueToUnits("0.000001"), 1n);
    assert.equal(valueToUnits(undefined), 0n);
  });

  test("formes exponentielles renvoyées par le ledger", () => {
    assert.equal(valueToUnits("1.23e5"), 123_000_000_000n);
    assert.equal(valueToUnits("5e-6"), 5n);
    assert.equal(valueToUnits("1E3"), 1_000_000_000n);
  });

  test("un dû au-delà de 6 décimales est arrondi à l'unité supérieure, un solde à l'unité inférieure", () => {
    assert.equal(valueToUnits("9133.1506849315"), 9_133_150_685n);
    assert.equal(valueToUnits("9133.1506849315", "down"), 9_133_150_684n);
    assert.equal(valueToUnits("9133.15"), 9_133_150_000n);
  });

  test("aller-retour exact à 6 décimales", () => {
    for (const units of [1n, 999_999n, 1_000_000n, 18_000_000_000n, 507_450_000n]) {
      assert.equal(valueToUnits(unitsToValue(units)), units);
    }
  });

  test("valeur illisible → erreur", () => {
    assert.throws(() => valueToUnits("douze"), /illisible/);
  });
});

describe("montants et transactions RLUSD", () => {
  test("montant IOU : devise, émetteur, valeur décimale", () => {
    assert.deepEqual(stablecoinAmount(RLUSD, 1_020_500_000n), { currency: RLUSD_CURRENCY, issuer: RLUSD.issuer, value: "1020.5" });
    assert.throws(() => stablecoinAmount(RLUSD, 0n), /invalide/);
  });

  test("TrustSet du détenteur vers l'émetteur, plafond large", () => {
    const holder = Wallet.generate().address;
    const tx = trustLine(RLUSD, holder);
    assert.equal(tx.TransactionType, "TrustSet");
    assert.equal(tx.Account, holder);
    assert.equal(tx.LimitAmount.currency, RLUSD_CURRENCY);
    assert.equal(tx.LimitAmount.issuer, RLUSD.issuer);
    assert.ok(valueToUnits(tx.LimitAmount.value) >= 10n ** 15n);
  });

  test("Payment en valeur décimale", () => {
    const [from, to] = [Wallet.generate().address, Wallet.generate().address];
    assert.deepEqual(stablecoinPayment(RLUSD, from, to, 10_000_000_000n), {
      TransactionType: "Payment",
      Account: from,
      Destination: to,
      Amount: { currency: RLUSD_CURRENCY, issuer: RLUSD.issuer, value: "10000" },
    });
  });

  test("code de devise de 40 caractères hex affiché en ASCII, code standard inchangé", () => {
    assert.equal(currencyLabel(RLUSD_CURRENCY), "RLUSD");
    assert.equal(currencyLabel("USD"), "USD");
  });
});
