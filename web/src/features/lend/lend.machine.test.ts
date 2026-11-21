// Tests de l'espace prêteur : saisie des montants sans dérive, aperçus des ordres, transitions et historique.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { LenderFaucetResponse, LenderPosition, LenderTradeResponse } from "../../../../src/api/contract";
import {
  checkDeposit,
  checkWithdraw,
  faucetMovement,
  formatEurUnits,
  formatSharePrice,
  formatShares,
  initialLendState,
  lendTransition,
  movementSummary,
  parseEuros,
  parseShares,
  sharesInput,
  tradeMovement,
  utilisationPercent,
  type LendEvent,
  type LendState,
  type Movement,
} from "./lend.machine";

/** Part à 1,005 € ; 10 000 € disponibles, aucune part : la période de prêt (voie immédiate). */
const position: LenderPosition = {
  phase: "investment",
  shares: "0",
  value: "0",
  costBasis: "0",
  gain: "0",
  sharePrice: "1005000",
  variableYieldPercent: 5.9,
  eurcBalance: "10000000000",
  entry: { route: "immediate", max: "10000000000", bariCap: "20100000000" },
  exit: { route: "immediate", max: "0", bariCap: "20000000000" },
  immediateExitDiscountPercent: 0.5,
};

/** Même compte après un dépôt de 5 000 €. */
const holder: LenderPosition = {
  ...position,
  shares: "4975124378",
  value: "4999999999",
  costBasis: "5000000000",
  gain: "-1",
  eurcBalance: "5000000000",
  entry: { route: "immediate", max: "5000000000", bariCap: "15100000000" },
  exit: { route: "immediate", max: "4975124378", bariCap: "20000000000" },
};

describe("parseEuros / parseShares", () => {
  test("euros saisis → unités EURc exactes, sans dérive des flottants", () => {
    assert.deepEqual(parseEuros("19.99"), { ok: true, units: 19_990_000n });
    assert.deepEqual(parseEuros("1234567.89"), { ok: true, units: 1_234_567_890_000n });
    assert.deepEqual(parseEuros(" €5,000 "), { ok: true, units: 5_000_000_000n });
    assert.deepEqual(parseEuros("0.1"), { ok: true, units: 100_000n });
    assert.deepEqual(parseEuros(".5"), { ok: true, units: 500_000n });
  });

  test("montant vide, illisible, trop précis ou nul refusé avec la correction", () => {
    assert.deepEqual(parseEuros(""), { ok: false, error: "Enter an amount" });
    assert.deepEqual(parseEuros("5k"), { ok: false, error: "Enter a number, e.g. 5000" });
    assert.deepEqual(parseEuros("-5"), { ok: false, error: "Enter a number, e.g. 5000" });
    assert.deepEqual(parseEuros("1.234"), { ok: false, error: "Use at most 2 decimals" });
    assert.deepEqual(parseEuros("0.00"), { ok: false, error: "Enter an amount above zero" });
  });

  test("parts : jusqu'à 6 décimales (une part affichée = 10^6 unités)", () => {
    assert.deepEqual(parseShares("4975.124378"), { ok: true, units: 4_975_124_378n });
    assert.deepEqual(parseShares("1,000"), { ok: true, units: 1_000_000_000n });
    assert.deepEqual(parseShares("0.0000001"), { ok: false, error: "Use at most 6 decimals" });
  });

  test("toutes les parts : saisie exacte, relue à l'identique", () => {
    assert.equal(sharesInput(4_975_124_378n), "4975.124378");
    assert.equal(sharesInput(5_000_000_000n), "5000");
    assert.equal(sharesInput(500_000n), "0.5");
    assert.deepEqual(parseShares(sharesInput(4_975_124_378n)), { ok: true, units: 4_975_124_378n });
  });
});

describe("formats", () => {
  test("euros arrondis au centime inférieur : « at most » ne dépasse jamais le maximum", () => {
    assert.equal(formatEurUnits(4_999_995_000n), "€4,999.99");
    assert.equal(formatEurUnits(10_000_000_000n), "€10,000.00");
    assert.equal(formatEurUnits(-1_500_000n), "-€1.50");
  });

  test("parts exactes, au moins 2 décimales", () => {
    assert.equal(formatShares(4_975_124_378n), "4,975.124378");
    assert.equal(formatShares(5_000_000_000n), "5,000.00");
    assert.equal(formatShares(1_500_000n), "1.50");
    assert.equal(formatShares(0n), "0.00");
  });

  test("prix de la part : 4 à 6 décimales", () => {
    assert.equal(formatSharePrice("1005000"), "€1.0050");
    assert.equal(formatSharePrice("1000123"), "€1.000123");
  });
});

describe("checkDeposit", () => {
  test("voie immédiate : parts au prix de la part, arrondies en faveur du fonds, sans frais", () => {
    assert.deepEqual(checkDeposit(position, "5000"), {
      ok: true,
      amount: 5_000_000_000n,
      preview: { route: "immediate", eurc: 5_000_000_000n, shares: 4_975_124_378n, fee: 0n },
    });
  });

  test("voie native pendant la souscription", () => {
    const subscription: LenderPosition = { ...position, phase: "subscription", sharePrice: "1000000", entry: { route: "native", max: "10000000000" } };
    assert.deepEqual(checkDeposit(subscription, "250.50"), {
      ok: true,
      amount: 250_500_000n,
      preview: { route: "native", eurc: 250_500_000n, shares: 250_500_000n, fee: 0n },
    });
  });

  test("au-dessus du solde : le maximum à saisir", () => {
    assert.deepEqual(checkDeposit(position, "10000.01"), {
      ok: false,
      error: "Above your balance of €10,000.00. Enter at most €10,000.00.",
    });
  });

  test("solde vide : ajouter des euros de test d'abord", () => {
    const empty = { ...position, eurcBalance: "0", entry: { ...position.entry, max: "0" } };
    assert.deepEqual(checkDeposit(empty, "100"), { ok: false, error: "Your balance is empty: add test euros first." });
  });

  test("au-dessus du stock de parts de Bari : le plafond et le maximum", () => {
    const capped = { ...position, entry: { route: "immediate" as const, max: "3000000000", bariCap: "3000000000" } };
    assert.deepEqual(checkDeposit(capped, "5000"), {
      ok: false,
      error: "Bari can sell at most €3,000.00 of fund shares right now. Enter at most €3,000.00.",
    });
  });

  test("rachat : dépôts fermés, le retrait reste ouvert", () => {
    const redemption = { ...position, phase: "redemption" as const, entry: { route: null, max: "0" } };
    assert.deepEqual(checkDeposit(redemption, "100"), {
      ok: false,
      error: "Deposits are closed: the fund is repaying its lenders. You can still withdraw.",
    });
  });

  test("montant trop petit pour une unité de part", () => {
    const expensive = { ...position, sharePrice: "1000000000000" };
    assert.deepEqual(checkDeposit(expensive, "0.01"), { ok: false, error: "Amount too small to buy a share." });
  });

  test("saisie invalide : l'erreur de lecture", () => {
    assert.deepEqual(checkDeposit(position, ""), { ok: false, error: "Enter an amount" });
  });
});

describe("checkWithdraw", () => {
  test("sortie immédiate : prix de la part −0,5 %, frais affichés, arrondi inférieur", () => {
    assert.deepEqual(checkWithdraw(holder, "1000"), {
      ok: true,
      amount: 1_000_000_000n,
      preview: { route: "immediate", eurc: 999_975_000n, shares: 1_000_000_000n, fee: 5_025_000n },
    });
  });

  test("sortie native (souscription ou rachat) : au prix de la part, sans frais", () => {
    const redemption: LenderPosition = { ...holder, phase: "redemption", exit: { route: "native", max: holder.shares } };
    assert.deepEqual(checkWithdraw(redemption, "1000"), {
      ok: true,
      amount: 1_000_000_000n,
      preview: { route: "native", eurc: 1_005_000_000n, shares: 1_000_000_000n, fee: 0n },
    });
  });

  test("aucune part : déposer d'abord", () => {
    assert.deepEqual(checkWithdraw(position, "1"), { ok: false, error: "You hold no shares yet: deposit first." });
  });

  test("plus de parts que détenues : le maximum", () => {
    assert.deepEqual(checkWithdraw(holder, "5000"), {
      ok: false,
      error: "You hold 4,975.124378 shares. Enter at most 4,975.124378.",
    });
  });

  test("au-delà de la réserve de Bari : le maximum, ou la sortie gratuite à l'échéance", () => {
    const capped = { ...holder, exit: { route: "immediate" as const, max: "2000000000", bariCap: "2000000000" } };
    assert.deepEqual(checkWithdraw(capped, "3000"), {
      ok: false,
      error: "Bari's reserve buys back at most 2,000.00 shares right now. Enter at most 2,000.00, or exit for free at maturity.",
    });
  });
});

describe("utilisationPercent", () => {
  test("part des actifs du fonds prêtée, au centième de point", () => {
    assert.equal(utilisationPercent({ assetsTotal: "200000000000", assetsAvailable: "150000000000" }), 25);
    assert.equal(utilisationPercent({ assetsTotal: "300000000000", assetsAvailable: "200000000000" }), 33.33);
    assert.equal(utilisationPercent({ assetsTotal: "0", assetsAvailable: "0" }), 0);
  });
});

describe("mouvements", () => {
  const tx = (hash: string) => ({ label: "Payment", hash, result: "tesSUCCESS" });
  const faucet: LenderFaucetResponse = { hash: "F", amount: "10000000000", transactions: [tx("F")] };
  const deposit: LenderTradeResponse = {
    hash: "B",
    route: "immediate",
    phase: "investment",
    amount: "5000000000",
    shares: "4975124378",
    transactions: [tx("B"), tx("I1"), tx("I2")],
  };

  test("réponse de l'API → mouvement, hash principal en tête, sans doublon", () => {
    assert.deepEqual(faucetMovement(faucet), { action: "faucet", eurc: 10_000_000_000n, hash: "F", hashes: ["F"] });
    assert.deepEqual(tradeMovement("deposit", deposit), {
      action: "deposit",
      route: "immediate",
      eurc: 5_000_000_000n,
      shares: 4_975_124_378n,
      hash: "B",
      hashes: ["B", "I1", "I2"],
    });
  });

  test("résumé lisible de chaque mouvement", () => {
    assert.equal(movementSummary(faucetMovement(faucet)), "Received €10,000.00 of test euros");
    assert.equal(movementSummary(tradeMovement("deposit", deposit)), "Deposited €5,000.00 for 4,975.124378 shares");
    assert.equal(
      movementSummary(tradeMovement("withdraw", { ...deposit, amount: "4950248756" })),
      "Sold 4,975.124378 shares for €4,950.24",
    );
  });
});

describe("lendTransition", () => {
  const movement: Movement = { action: "deposit", route: "immediate", eurc: 1n, shares: 1n, hash: "H", hashes: ["H"] };

  test("envoi, puis succès : le mouvement rejoint l'historique, le plus récent en tête", () => {
    const submitting = lendTransition(initialLendState, { type: "SUBMIT", action: "deposit" });
    assert.deepEqual(submitting, { operation: { status: "submitting", action: "deposit" }, history: [] });
    const done = lendTransition(submitting, { type: "SUCCEEDED", movement });
    assert.deepEqual(done, { operation: { status: "done", movement }, history: [movement] });
    const next = lendTransition(lendTransition(done, { type: "SUBMIT", action: "faucet" }), {
      type: "SUCCEEDED",
      movement: { action: "faucet", eurc: 2n, hash: "F", hashes: ["F"] },
    });
    assert.deepEqual(
      next.history.map((entry) => entry.hash),
      ["F", "H"],
    );
  });

  test("échec : le message, l'historique intact, puis un nouvel envoi", () => {
    const failed = lendTransition({ operation: { status: "submitting", action: "withdraw" }, history: [movement] }, {
      type: "FAILED",
      message: "Amount above the immediate exit cap",
    });
    assert.deepEqual(failed, {
      operation: { status: "failed", action: "withdraw", message: "Amount above the immediate exit cap" },
      history: [movement],
    });
    assert.deepEqual(lendTransition(failed, { type: "SUBMIT", action: "withdraw" }).operation, {
      status: "submitting",
      action: "withdraw",
    });
  });

  test("un événement invalide ne change pas l'état", () => {
    const submitting: LendState = { operation: { status: "submitting", action: "deposit" }, history: [] };
    const done: LendState = { operation: { status: "done", movement }, history: [movement] };
    for (const [state, event] of [
      [initialLendState, { type: "SUCCEEDED", movement }],
      [initialLendState, { type: "FAILED", message: "m" }],
      [submitting, { type: "SUBMIT", action: "withdraw" }],
      [submitting, { type: "SUCCEEDED", movement: { ...movement, action: "withdraw" } }],
      [done, { type: "SUCCEEDED", movement }],
      [done, { type: "FAILED", message: "m" }],
    ] as [LendState, LendEvent][]) {
      assert.equal(lendTransition(state, event), state);
    }
  });
});
