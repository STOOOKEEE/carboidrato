// Paramètres publics de la preuve : les paliers de l'offre, jamais un seuil fixé par le serveur.

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { Client } from "xrpl";
import type { ProofParams } from "../../contract.js";
import { buildApp } from "../app.js";
import { fakeApiConfig, fakeContext } from "../fakeContext.js";

const NETWORK_ID = 1000;

let app: FastifyInstance;

before(async () => {
  const client = new Client("wss://alphanet.example");
  client.networkID = NETWORK_ID;
  app = await buildApp(fakeApiConfig, fakeContext({ client }));
  await app.ready();
});

after(() => app.close());

describe("GET /api/proof/params", () => {
  test("publie les paliers de l'offre en centimes, croissants : le navigateur choisit celui de sa facture", async () => {
    const response = await app.inject({ method: "GET", url: "/api/proof/params" });
    assert.equal(response.statusCode, 200);
    const params = response.json<ProofParams & { thresholdCents?: string }>();
    assert.deepEqual(params.thresholdsCents, ["500000", "1000000", "2000000", "5000000", "10000000"]);
    assert.equal(params.thresholdCents, undefined);
    assert.equal(params.networkId, NETWORK_ID);
  });
});
