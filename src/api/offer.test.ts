// Offre publique du fonds : avance fixe adossée au seuil prouvé, indépendante du montant exact de la facture.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { daysUntil, fundOffer } from "./offer.js";

describe("offre de financement", () => {
  test("une facture d'au moins 10 000 € à 90 jours donne 8 955 € pour 178,16 €", () => {
    const offer = fundOffer(90);
    assert.equal(offer.provenThresholdEur, 10_000);
    assert.equal(offer.principalEur, 9_000);
    assert.equal(offer.feeEur, 45);
    assert.equal(offer.netAdvanceEur, 8_955);
    assert.equal(offer.totalCostEur, 178.16);
    assert.equal(offer.termDays, 90);
  });

  test("la durée court jusqu'à l'échéance, au jour entier supérieur", () => {
    assert.equal(daysUntil(86_400 * 90 + 1, 0), 91);
    assert.equal(daysUntil(0, 10), 0);
  });
});
