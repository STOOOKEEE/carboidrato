// Tests du seuil prouvé : dérivé de l'avance demandée, jamais du montant exact de la facture.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { loanTerms, provenThresholdCents } from "./loanTerms.js";

describe("seuil prouvé", () => {
  test("une avance de 9 000 € demande une facture d'au moins 10 000 €", () => {
    assert.equal(provenThresholdCents(900_000n), 1_000_000n);
  });

  test("le seuil est le plus petit qui couvre l'avance à 90 %", () => {
    const threshold = provenThresholdCents(900_001n);
    assert.equal(threshold, 1_000_002n);
    assert.ok((threshold - 1n) * 90n < 900_001n * 100n);
  });

  test("les conditions de la facture type portent le seuil de son avance", () => {
    assert.equal(loanTerms().provenThresholdCents, 1_000_000n);
  });
});
