// Tests de la page transaction : route, états de chargement et faits affichés.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { TxDetail } from "../../../../src/api/contract";
import { txHashFromRoute, txRoute } from "../../routes";
import { certificateFacts, initialTxView, keyFacts, txTitle, txViewFromResponse } from "./txView";

const HASH = "A".repeat(64);

const detail: TxDetail = {
  hash: HASH,
  type: "Batch",
  result: "tesSUCCESS",
  validated: true,
  ledgerIndex: 42,
  accounts: [{ role: "Account", address: "rSME" }],
  fields: [{ name: "Fee", value: "40" }],
  createdObjects: [],
  innerTransactions: [],
  raw: { tx: {}, meta: {} },
};

describe("route #/tx/<hash>", () => {
  test("aller-retour entre hash et route", () => {
    assert.equal(txRoute(HASH), `#/tx/${HASH}`);
    assert.equal(txHashFromRoute(txRoute(HASH)), HASH);
    assert.equal(txHashFromRoute("#/app"), undefined);
  });
});

describe("états de la page", () => {
  test("un hash mal formé n'est pas demandé au serveur", () => {
    assert.deepEqual(initialTxView("xyz"), { status: "invalid" });
    assert.deepEqual(initialTxView(HASH.toLowerCase()), { status: "loading" });
  });

  test("réponse du serveur : détail, introuvable, erreur", () => {
    assert.deepEqual(txViewFromResponse(200, detail), { status: "ready", detail });
    assert.deepEqual(txViewFromResponse(404, { error: "inconnue" }), { status: "notFound" });
    assert.deepEqual(txViewFromResponse(502, { error: "Nœud XRPL injoignable" }), {
      status: "error",
      message: "Nœud XRPL injoignable",
    });
    assert.deepEqual(txViewFromResponse(500, undefined), {
      status: "error",
      message: "Atlas API unavailable (HTTP 500).",
    });
  });
});

describe("textes", () => {
  test("titre : type et résultat en clair", () => {
    assert.equal(txTitle(detail), "Batch succeeded");
    assert.equal(txTitle({ ...detail, type: "CredentialCreate", result: "tecDUPLICATE" }), "CredentialCreate failed (tecDUPLICATE)");
    assert.equal(txTitle({ ...detail, validated: false }), "Batch not validated yet");
  });

  test("faits clés : résultat, ledger, comptes puis champs", () => {
    assert.deepEqual(keyFacts(detail), [
      { label: "Result", value: "tesSUCCESS" },
      { label: "Ledger", value: "42" },
      { label: "Account", value: "rSME" },
      { label: "Fee", value: "40" },
    ]);
  });

  test("certificat : seuil en dollars et échéance en date", () => {
    const facts = certificateFacts({
      proofSystem: "groth16",
      commitment: "C".repeat(64),
      nullifier: "D".repeat(64),
      pseudonym: "E".repeat(64),
      debtorsRoot: "F".repeat(64),
      account: "rSME",
      registry: "rREG",
      networkId: 1000,
      vintage: 2026,
      thresholdCents: 1_000_000,
      dueDate: Date.UTC(2027, 1, 18) / 1000,
    });
    const byLabel = new Map(facts.map((fact) => [fact.label, fact.value]));
    assert.equal(byLabel.get("Proof system"), "Groth16");
    assert.equal(byLabel.get("Proven minimum amount"), "$10,000.00");
    assert.equal(byLabel.get("Due date"), "18 Feb 2027");
    assert.equal(byLabel.get("Invoice fingerprint N"), "D".repeat(64));
  });
});
