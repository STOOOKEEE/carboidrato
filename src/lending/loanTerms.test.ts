// Tests des conditions du prêt : seuil prouvé dérivé de l'avance demandée, échéance bornée par le rachat du fonds.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { loanPaymentInterval, loanTerms, provenThresholdCents } from "./loanTerms.js";

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
    assert.throws(
      () => loanPaymentInterval({ now: NOW, invoiceDueDate: NOW, redemptionDate: REDEMPTION_DATE }),
      /échéance de la facture dépassée/,
    );
  });

  test("un prêt plus court que le minimum du ledger est refusé", () => {
    assert.throws(
      () => loanPaymentInterval({ now: NOW, invoiceDueDate: NOW + 59, redemptionDate: REDEMPTION_DATE }),
      /trop court/,
    );
    assert.throws(
      () => loanPaymentInterval({ now: NOW, invoiceDueDate: NOW + 90 * DAY_S, redemptionDate: NOW + 60 + 30 + 59 }),
      /trop court/,
    );
  });
});
