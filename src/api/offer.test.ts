// Barème public du fonds : une offre par palier, sur la durée du prêt bornée par le rachat, sans le montant de la facture.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { daysUntil, fundOffer } from "./offer.js";

const DAY_S = 86_400;
const NOW = 1_800_000_000;

describe("barème de l'offre", () => {
  test("un palier par seuil public, avec le taux d'avance, les frais et la durée", () => {
    const offer = fundOffer({ dueDate: NOW + 90 * DAY_S, now: NOW });
    assert.deepEqual(
      offer?.tiers.map((tier) => tier.provenThresholdUsd),
      [5_000, 10_000, 20_000, 50_000, 100_000],
    );
    assert.equal(offer?.advanceRatePercent, 90);
    assert.equal(offer?.feeRatePercent, 0.5);
    assert.equal(offer?.termDays, 90);
    assert.equal(offer?.loanDueDate, new Date((NOW + 90 * DAY_S) * 1_000).toISOString());
  });

  test("palier de 10 000 $ à 90 jours : 9 000 $ avancés, 45 $ de frais, 8 955 $ reçus pour 178,16 $", () => {
    const tier = fundOffer({ dueDate: NOW + 90 * DAY_S, now: NOW })?.tiers[1];
    assert.equal(tier?.provenThresholdUsd, 10_000);
    assert.equal(tier?.principalUsd, 9_000);
    assert.equal(tier?.feeUsd, 45);
    assert.equal(tier?.netAdvanceUsd, 8_955);
    assert.equal(tier?.totalCostUsd, 178.16);
    assert.equal(tier?.termDays, 90);
  });

  test("l'échéance du prêt est bornée par le rachat du fonds", () => {
    const offer = fundOffer({ dueDate: NOW + 150 * DAY_S, now: NOW, latestMaturity: NOW + 30 * DAY_S });
    assert.equal(offer?.termDays, 30);
    assert.equal(offer?.loanDueDate, new Date((NOW + 30 * DAY_S) * 1_000).toISOString());
  });

  test("aucune offre si le prêt ne peut plus courir", () => {
    assert.equal(fundOffer({ dueDate: NOW + 90 * DAY_S, now: NOW, latestMaturity: NOW }), undefined);
    assert.equal(fundOffer({ dueDate: NOW - 1, now: NOW }), undefined);
  });

  test("la durée court jusqu'à l'échéance, au jour entier supérieur", () => {
    assert.equal(daysUntil(86_400 * 90 + 1, 0), 91);
    assert.equal(daysUntil(0, 10), 0);
  });
});
