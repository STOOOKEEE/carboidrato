// État persisté du fonds : un fonds RLUSD relu tel quel, un ancien fonds à actif MPT ignoré, un fichier illisible refusé.

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import type { Fund } from "../../fund/fund.js";
import { RLUSD_CURRENCY } from "../../xrpl/stablecoin.js";
import { FundStateStore } from "./stateStore.js";

const fund: Fund = {
  stablecoin: { currency: RLUSD_CURRENCY, issuer: "rIssuer" },
  domainId: "DOMAIN",
  cohort: { vaultId: "VAULT", shareMptId: "SHARES", subscriptionDate: 1, redemptionDate: 2 },
  brokerId: "BROKER",
  manifest: { debtorsRoot: "00", vintage: 202611, registry: "rRegistry" },
};

function stateFile(content?: unknown): string {
  const file = join(mkdtempSync(join(tmpdir(), "bari-state-")), "state.json");
  if (content !== undefined) writeFileSync(file, JSON.stringify(content));
  return file;
}

describe("FundStateStore", () => {
  test("un fonds RLUSD est persisté puis relu", () => {
    const file = stateFile();
    new FundStateStore(file).reset(fund);
    assert.deepEqual(new FundStateStore(file).current?.fund, fund);
  });

  test("un ancien fonds dont l'actif est un MPT n'est pas repris : aucun fonds courant", () => {
    const { stablecoin: _stablecoin, ...rest } = fund;
    const legacy = { fund: { ...rest, assetId: "00".repeat(24) }, invoices: [], loans: [] };
    assert.equal(new FundStateStore(stateFile(legacy)).current, undefined);
  });

  test("un fichier d'un autre format est refusé", () => {
    assert.throws(() => new FundStateStore(stateFile({ something: "else" })), /Format inattendu/);
  });
});
