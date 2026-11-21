// Tests de la réutilisation du fonds de démo : seul un fonds alimenté, en phase d'investissement à plus de 24 h du rachat, sert.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FundState } from "../api/fund/stateStore.js";
import { isReusable } from "./fundReuse.js";

const DAY_S = 86_400;
const SUBSCRIPTION_DATE = 1_000_000;
/** Fonds ouvert jusqu'au pitch : plusieurs mois d'investissement. */
const REDEMPTION_DATE = SUBSCRIPTION_DATE + 130 * DAY_S;
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
