// Tests de la réutilisation du fonds de démo : seul un fonds alimenté, en phase d'investissement à plus de 24 h du rachat, sert.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FundState } from "../api/fund/stateStore.js";
import { isReusable, MAIRIE_REPAYMENTS_AHEAD, mairieTopUp } from "./fundReuse.js";

const DAY_S = 86_400;
const SUBSCRIPTION_DATE = 1_000_000;
/** Fonds ouvert jusqu'au pitch : plusieurs mois d'investissement. */
const REDEMPTION_DATE = SUBSCRIPTION_DATE + 130 * DAY_S;
const DURING_INVESTMENT = SUBSCRIPTION_DATE + 60;

function fundState(change: Partial<FundState> = {}): FundState {
  return {
    fund: {
      stablecoin: { currency: "RLUSD", issuer: "rIssuer" },
      domainId: "DOMAIN",
      cohort: { vaultId: "VAULT", shareMptId: "SHARES", subscriptionDate: SUBSCRIPTION_DATE, redemptionDate: REDEMPTION_DATE },
      brokerId: "BROKER",
      manifest: { debtorsRoot: "00", vintage: 202611, registry: "rRegistry" },
    },
    createdAt: "2026-11-21T00:00:00.000Z",
    deposited: true,
    redeemed: false,
    invoices: [],
    loans: [],
    ...change,
  };
}

describe("réutilisation du fonds de démo", () => {
  test("un fonds alimenté en phase d'investissement est réutilisé", () => {
    assert.equal(isReusable(fundState(), DURING_INVESTMENT), true);
  });

  test("un fonds encore en souscription n'est pas réutilisé", () => {
    assert.equal(isReusable(fundState(), SUBSCRIPTION_DATE - 1), false);
  });

  test("un fonds sans dépôts n'est pas réutilisé", () => {
    assert.equal(isReusable(fundState({ deposited: false }), DURING_INVESTMENT), false);
  });

  test("un fonds déjà racheté n'est pas réutilisé", () => {
    assert.equal(isReusable(fundState({ redeemed: true }), DURING_INVESTMENT), false);
  });

  test("le fonds est réutilisé jusqu'à 24 h avant le rachat, plus ensuite", () => {
    assert.equal(isReusable(fundState(), REDEMPTION_DATE - DAY_S), true);
    assert.equal(isReusable(fundState(), REDEMPTION_DATE - DAY_S + 1), false);
  });

  test("une marge de 30 min ne suffit plus", () => {
    assert.equal(isReusable(fundState(), REDEMPTION_DATE - 1_800), false);
  });

  test("un fonds en phase de rachat n'est pas réutilisé", () => {
    assert.equal(isReusable(fundState(), REDEMPTION_DATE), false);
  });
});

describe("réserve de la mairie pour les remboursements", () => {
  const REPAYMENT = 10_000_000_000n;
  const FLOOR = REPAYMENT * BigInt(MAIRIE_REPAYMENTS_AHEAD);

  test("une mairie vide est remontée au plancher", () => {
    assert.equal(mairieTopUp(0n, REPAYMENT), FLOOR);
  });

  test("seul le manque est envoyé", () => {
    assert.equal(mairieTopUp(REPAYMENT, REPAYMENT), FLOOR - REPAYMENT);
  });

  test("rien n'est envoyé au plancher ou au-dessus", () => {
    assert.equal(mairieTopUp(FLOOR, REPAYMENT), 0n);
    assert.equal(mairieTopUp(FLOOR + 1n, REPAYMENT), 0n);
  });

  test("le plancher couvre une suite e2e complète : trois factures de 10 340 $ remboursées l'une après l'autre", () => {
    const E2E_INVOICE = 10_340_000_000n;
    assert.ok(mairieTopUp(0n, REPAYMENT) >= 3n * E2E_INVOICE);
  });
});
