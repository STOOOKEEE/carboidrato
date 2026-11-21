// Espace organisme public : ses seules clés d'attestation, recherche d'un fournisseur par TVA, plus de signature serveur.

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { Wallet } from "xrpl";
import { deriveDebtor } from "../../../zk/index.js";
import type { BusinessLookup, PublicBodyKeys } from "../../contract.js";
import { buildApp } from "../app.js";
import { fakeApiConfig, fakeContext } from "../fakeContext.js";

const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const PASSWORD = "correct horse battery";

const managedWallets: Wallet[] = [];
let app: FastifyInstance;
const sessions: Record<"bari" | "lecce" | "lender" | "business", string> = { bari: "", lecce: "", lender: "", business: "" };

async function signup(body: object): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/auth/signup", payload: body });
  assert.equal(response.statusCode, 201, response.body);
  return String(response.headers["set-cookie"]).split(";")[0];
}

const get = (url: string, cookie?: string) => app.inject({ method: "GET", url, headers: cookie === undefined ? {} : { cookie } });

before(async () => {
  const context = fakeContext({
    provisionAccount: async ({ role }) => {
      if (role === "public_body") return undefined;
      const wallet = Wallet.generate();
      managedWallets.push(wallet);
      return { address: wallet.address, seed: wallet.seed ?? "" };
    },
  });
  app = await buildApp(fakeApiConfig, context);
  await app.ready();
  sessions.bari = await signup({ email: "ragioneria@comune.bari.it", password: PASSWORD, role: "public_body", profile: { ipaCode: "c_a662" } });
  sessions.lecce = await signup({ email: "ragioneria@comune.lecce.it", password: PASSWORD, role: "public_body", profile: { ipaCode: "c_e506" } });
  sessions.lender = await signup({
    email: "alice@example.com",
    password: PASSWORD,
    role: "lender",
    profile: { name: "Alice Rossi", country: "IT", riskAcknowledged: true },
  });
  sessions.business = await signup({
    email: "marco@costruzioni.it",
    password: PASSWORD,
    role: "business",
    profile: { company: "Marco Costruzioni S.r.l.", vatNumber: "IT 0123 4567 890" },
  });
});

after(() => app.close());

describe("GET /api/public-body/keys", () => {
  test("l'organisme de la session reçoit ses clés, et seulement les siennes", async () => {
    const [bari, lecce] = await Promise.all([deriveDebtor("Comune di Bari"), deriveDebtor("Comune di Lecce")]);
    const response = await get("/api/public-body/keys", sessions.lecce);
    assert.equal(response.statusCode, HTTP_OK);
    const keys = response.json<PublicBodyKeys>();
    assert.deepEqual(keys, {
      name: "Comune di Lecce",
      ipaCode: "c_e506",
      eddsaPrivateKey: lecce.eddsaPrivateKey.toString("hex"),
      hmacKey: lecce.hmacKey.toString("hex"),
      publicKey: { ax: lecce.publicKey.ax.toString(), ay: lecce.publicKey.ay.toString() },
    });
    assert.ok(!response.body.includes(bari.eddsaPrivateKey.toString("hex")));
    assert.ok(!response.body.includes(bari.hmacKey.toString("hex")));

    const own = (await get("/api/public-body/keys", sessions.bari)).json<PublicBodyKeys>();
    assert.equal(own.eddsaPrivateKey, bari.eddsaPrivateKey.toString("hex"));
  });

  test("sans session → 401 ; prêteur ou entreprise → 403", async () => {
    assert.equal((await get("/api/public-body/keys")).statusCode, HTTP_UNAUTHORIZED);
    assert.equal((await get("/api/public-body/keys", sessions.lender)).statusCode, HTTP_FORBIDDEN);
    assert.equal((await get("/api/public-body/keys", sessions.business)).statusCode, HTTP_FORBIDDEN);
  });
});

describe("GET /api/businesses/by-vat/:vat", () => {
  test("entreprise inscrite : raison sociale et compte XRPL, jamais la seed", async () => {
    const response = await get("/api/businesses/by-vat/it01234567890", sessions.bari);
    assert.equal(response.statusCode, HTTP_OK);
    const business = managedWallets.at(-1);
    assert.deepEqual(response.json<BusinessLookup>(), {
      company: "Marco Costruzioni S.r.l.",
      vatNumber: "IT01234567890",
      address: business?.address,
    });
    assert.ok(!response.body.includes(business?.seed ?? "?"));
  });

  test("TVA inconnue → 404", async () => {
    assert.equal((await get("/api/businesses/by-vat/IT99999999999", sessions.bari)).statusCode, HTTP_NOT_FOUND);
  });

  test("sans session → 401 ; autre rôle → 403", async () => {
    assert.equal((await get("/api/businesses/by-vat/IT01234567890")).statusCode, HTTP_UNAUTHORIZED);
    assert.equal((await get("/api/businesses/by-vat/IT01234567890", sessions.business)).statusCode, HTTP_FORBIDDEN);
  });
});

test("la signature côté serveur n'existe plus : la facture est signée dans le navigateur de l'organisme", async () => {
  const url = ["", "api", "debtor", "attest"].join("/");
  const response = await app.inject({ method: "POST", url, payload: {} });
  assert.equal(response.statusCode, HTTP_NOT_FOUND);
  assert.equal(response.json<{ message: string }>().message, `Route POST:${url} not found`);
});
