// Tests de la réutilisation du fonds de démo : seul un fonds alimenté, en phase d'investissement avec de la marge, sert.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FundState } from "../api/fund/stateStore.js";
import { isReusable, MIN_REMAINING_INVESTMENT_S } from "./fundReuse.js";

const SUBSCRIPTION_DATE = 1_000_000;
const REDEMPTION_DATE = SUBSCRIPTION_DATE + 21_600;
const DURING_INVESTMENT = SUBSCRIPTION_DATE + 60;

function fundState(change: Partial<FundState> = {}): FundState {
  return {
    fund: {
      assetId: "ASSET",
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

  test("le fonds doit laisser la marge minimale avant le rachat", () => {
    assert.equal(isReusable(fundState(), REDEMPTION_DATE - MIN_REMAINING_INVESTMENT_S), true);
    assert.equal(isReusable(fundState(), REDEMPTION_DATE - MIN_REMAINING_INVESTMENT_S + 1), false);
  });

  test("un fonds en phase de rachat n'est pas réutilisé", () => {
    assert.equal(isReusable(fundState(), REDEMPTION_DATE), false);
  });
});
