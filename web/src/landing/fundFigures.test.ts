// Tests des chiffres clés du fonds affichés sur la landing, lus de `GET /api/fund`.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { fundFigures } from "./fundFigures";

describe("fundFigures", () => {
  test("taille du fonds en euros entiers, factures financées, fin de la période de prêt", () => {
    const fund = {
      redemptionStartsAt: "2027-03-31T00:00:00.000Z",
      vault: { assetsTotal: "140091330000" },
      loans: [{ status: "repaid" }, { status: "active" }],
    };
    assert.deepEqual(fundFigures(fund), [
      { value: "€140,091", label: "in the fund" },
      { value: "2", label: "invoices financed" },
      { value: "31 Mar 2027", label: "lending until" },
    ]);
  });
});
