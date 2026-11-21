// Routes de l'API du fonds par app.inject(), sur un faux contexte : aucun appel réseau.

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { Wallet, type LedgerEntry } from "xrpl";
import { ACTOR_NAMES, type Actors } from "../../accounts/actors.js";
import { FakeLedger } from "../../xrpl/fakeLedger.js";
import { PUBLIC_SIGNAL_ORDER } from "../../zk/index.js";
import { buildApp } from "./app.js";
import { fakeApiConfig, fakeContext } from "./fakeContext.js";

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const NULLIFIER = "AB".repeat(32);
const REGISTRATION_TX = "CD".repeat(32);
const WITNESS_FIELDS = ["amount", "uuid", "signature", "pathElements", "blinding"];

const actors = Object.fromEntries(ACTOR_NAMES.map((name) => [name, Wallet.generate()])) as Actors;
const ledger = new FakeLedger(1000);
let app: FastifyInstance;

const proofBody = () => ({
  proof: {
    pi_a: ["1", "2", "1"],
    pi_b: [
      ["1", "2"],
      ["3", "4"],
      ["1", "0"],
    ],
    pi_c: ["5", "6", "1"],
    protocol: "groth16",
    curve: "bn128",
  },
  publicSignals: PUBLIC_SIGNAL_ORDER.map((_, index) => String(index + 1)),
});

const registration: LedgerEntry.Credential = {
  LedgerEntryType: "Credential",
  Flags: 0,
  Subject: actors.bari_registry.address,
  Issuer: actors.sme.address,
  CredentialType: NULLIFIER,
  IssuerNode: "0",
  SubjectNode: "0",
  PreviousTxnID: REGISTRATION_TX,
  PreviousTxnLgrSeq: 1,
  index: "EF".repeat(32),
};

before(async () => {
  ledger.putCredential(registration);
  app = await buildApp(fakeApiConfig, fakeContext({ actors, ledger }));
  await app.ready();
});

after(() => app.close());

describe("POST /api/sme/certificate", () => {
  test("une preuve bien formée passe la validation (refus suivant : aucun fonds ouvert)", async () => {
    const response = await app.inject({ method: "POST", url: "/api/sme/certificate", payload: proofBody() });
    assert.equal(response.statusCode, HTTP_NOT_FOUND);
  });

  for (const field of WITNESS_FIELDS) {
    test(`refuse un corps qui contient le champ du témoin « ${field} »`, async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/sme/certificate",
        payload: { ...proofBody(), [field]: "1" },
      });
      assert.equal(response.statusCode, HTTP_BAD_REQUEST);
      assert.match(response.json<{ error: string }>().error, /additional properties/);
    });
  }

  test("refuse un champ en trop dans la preuve elle-même", async () => {
    const body = proofBody();
    const response = await app.inject({
      method: "POST",
      url: "/api/sme/certificate",
      payload: { ...body, proof: { ...body.proof, blinding: "7" } },
    });
    assert.equal(response.statusCode, HTTP_BAD_REQUEST);
  });
});

describe("routes de preuve côté serveur supprimées", () => {
  for (const url of ["circuit-input", "certificate/server-proof"].map((route) => `/api/sme/${route}`)) {
    test(`POST ${url} → 404`, async () => {
      const response = await app.inject({ method: "POST", url, payload: {} });
      assert.equal(response.statusCode, HTTP_NOT_FOUND);
      assert.equal(response.json<{ message: string }>().message, `Route POST:${url} not found`);
    });
  }
});

describe("GET /api/registry/:nullifier", () => {
  test("N enregistré par la PME → hash de la transaction d'enregistrement", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/registry/${NULLIFIER.toLowerCase()}?account=${actors.sme.address}`,
    });
    assert.deepEqual(response.json(), { registered: true, txHash: REGISTRATION_TX });
  });

  test("N inconnu → non enregistré", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/registry/${"12".repeat(32)}?account=${actors.sme.address}`,
    });
    assert.deepEqual(response.json(), { registered: false });
  });
});

test("le KYB passe par l'inscription : POST /api/sme/kyb n'existe plus", async () => {
  const url = "/api/sme/kyb";
  const response = await app.inject({ method: "POST", url, payload: {} });
  assert.equal(response.statusCode, HTTP_NOT_FOUND);
  assert.equal(response.json<{ message: string }>().message, `Route POST:${url} not found`);
});
