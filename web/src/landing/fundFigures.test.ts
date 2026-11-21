// Tests des chiffres clés du fonds affichés sur la landing, lus de `GET /api/fund`.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { fundFigures } from "./fundFigures";

const fund = {
  phase: "investment",
  redemptionStartsAt: "2027-03-31T00:00:00.000Z",
  vault: { assetsTotal: "140091330000", assetsAvailable: "122091330000", lossUnrealized: "0" },
  loans: [{ status: "repaid" }, { status: "active" }],
};

describe("fundFigures", () => {
  test("taille du fonds en euros entiers, factures financées, fin de la période de prêt", () => {
    assert.deepEqual(fundFigures(fund), [
      { value: "€140,091", label: "in the fund" },
      { value: "2", label: "invoices financed" },
      { value: "31 Mar 2027", label: "lending until" },
    ]);
  });

  test("réponse illisible ou absence de fonds : aucun chiffre", () => {
    assert.equal(fundFigures(undefined), undefined);
    assert.equal(fundFigures({ error: "No fund" }), undefined);
    assert.equal(fundFigures({ ...fund, vault: { assetsTotal: "abc" } }), undefined);
  });
});
