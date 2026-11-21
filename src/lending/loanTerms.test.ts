// Tests des conditions du prêt : palier public prouvé, avance de 90 % du palier, frais, échéance bornée par le rachat.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { eurToCents, eurToUnits } from "../lib/amounts.js";
import { isOfferTier, loanPaymentInterval, loanTerms, maturityProblem, OFFER_TIERS_EUR, offerTier } from "./loanTerms.js";

describe("paliers de l'offre", () => {
  test("les seuils publics sont 5 000, 10 000, 20 000, 50 000 et 100 000 €", () => {
    assert.deepEqual(OFFER_TIERS_EUR, [5_000, 10_000, 20_000, 50_000, 100_000]);
  });

  test("une facture de 10 340 € relève du palier de 10 000 €", () => {
    assert.equal(offerTier(eurToUnits(10_340)), eurToUnits(10_000));
  });

  test("un montant égal à un seuil relève de ce palier ; au-delà du dernier, le dernier", () => {
    assert.equal(offerTier(eurToUnits(5_000)), eurToUnits(5_000));
    assert.equal(offerTier(eurToUnits(250_000)), eurToUnits(100_000));
  });

  test("sous 5 000 € : aucune offre", () => {
    assert.equal(offerTier(eurToUnits(4_999)), undefined);
    assert.throws(() => loanTerms(eurToUnits(4_999)), /premier palier/);
  });

  test("seul un seuil public est un palier", () => {
    assert.equal(isOfferTier(eurToCents(20_000)), true);
    assert.equal(isOfferTier(eurToCents(12_000)), false);
  });
});

describe("conditions du palier", () => {
  test("palier de 10 000 € : avance 9 000 €, frais 45 €, la PME reçoit 8 955 €", () => {
    const terms = loanTerms(eurToUnits(10_000));
    assert.equal(terms.principal, eurToUnits(9_000));
    assert.equal(terms.originationFee, eurToUnits(45));
    assert.equal(terms.netAdvance, eurToUnits(8_955));
    assert.equal(terms.provenThresholdCents, eurToCents(10_000));
  });

  test("l'avance dérive du palier, pas du montant exact de la facture", () => {
    assert.deepEqual(loanTerms(eurToUnits(10_340)), loanTerms(eurToUnits(10_000)));
    assert.equal(loanTerms(eurToUnits(60_000)).principal, eurToUnits(45_000));
  });

  test("les conditions de la facture type portent le palier de 10 000 €", () => {
    assert.equal(loanTerms().provenThresholdCents, eurToCents(10_000));
  });
});

describe("échéance du prêt", () => {
  const NOW = 1_000_000;
  const DAY_S = 86_400;
  const REDEMPTION_DATE = NOW + 120 * DAY_S;
  /** Dernier instant accepté par le ledger : 60 s avant le rachat, moins 30 s d'écart d'heure entre ledgers. */
  const LATEST_DUE_DATE = REDEMPTION_DATE - 60 - 30;

  test("une facture payable avant le rachat donne un prêt jusqu'à son échéance", () => {
    assert.equal(loanPaymentInterval({ now: NOW, invoiceDueDate: NOW + 90 * DAY_S, redemptionDate: REDEMPTION_DATE }), 90 * DAY_S);
  });

  test("une facture payable après le rachat donne un prêt borné par le rachat", () => {
    const interval = loanPaymentInterval({ now: NOW, invoiceDueDate: NOW + 150 * DAY_S, redemptionDate: REDEMPTION_DATE });
    assert.equal(interval, LATEST_DUE_DATE - NOW);
  });

  test("une facture déjà échue est refusée", () => {
    const inputs = { now: NOW, invoiceDueDate: NOW, redemptionDate: REDEMPTION_DATE };
    assert.match(maturityProblem(inputs) ?? "", /due date has passed/);
    assert.throws(() => loanPaymentInterval(inputs), /due date has passed/);
  });

  test("un prêt plus court que le minimum du ledger est refusé", () => {
    assert.throws(
      () => loanPaymentInterval({ now: NOW, invoiceDueDate: NOW + 59, redemptionDate: REDEMPTION_DATE }),
      /too short/,
    );
    assert.throws(
      () => loanPaymentInterval({ now: NOW, invoiceDueDate: NOW + 90 * DAY_S, redemptionDate: NOW + 60 + 30 + 59 }),
      /too short/,
    );
  });

  test("une échéance valide ne lève aucun problème", () => {
    assert.equal(maturityProblem({ now: NOW, invoiceDueDate: NOW + 90 * DAY_S, redemptionDate: REDEMPTION_DATE }), undefined);
  });
});
