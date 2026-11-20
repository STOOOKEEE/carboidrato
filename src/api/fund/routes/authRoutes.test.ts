// Comptes et sessions par app.inject() : inscription, cookie signé, connexion, garde de rôle, sans réseau.

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { Wallet } from "xrpl";
import type { AccountProfile } from "../../../accounts/userStore.js";
import type { AccountView, SignupResponse } from "../../contract.js";
import { buildApp } from "../app.js";
import { requireRole } from "../auth.js";
import { fakeContext } from "../fakeContext.js";

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_NO_CONTENT = 204;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_CONFLICT = 409;
const SESSION_MAX_AGE_S = 7 * 86_400;
const PASSWORD = "correct horse battery";

const lenderSignup = {
  email: "alice@example.com",
  password: PASSWORD,
  role: "lender",
  profile: { name: "Alice Rossi", country: "IT", riskAcknowledged: true },
};
const businessSignup = {
  email: "marco@costruzioni.it",
  password: PASSWORD,
  role: "business",
  profile: { company: "Marco Costruzioni S.r.l.", vatNumber: "IT01234567890" },
};

const provisioned: AccountProfile[] = [];
const managedWallets = new Map<string, Wallet>();
let app: FastifyInstance;

function sessionCookie(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  assert.ok(header !== undefined, "Set-Cookie attendu");
  return header.split(";")[0];
}

async function signup(body: object): Promise<{ status: number; cookie?: string; json: SignupResponse }> {
  const response = await app.inject({ method: "POST", url: "/api/auth/signup", payload: body });
  const cookie = response.headers["set-cookie"] === undefined ? undefined : sessionCookie(response.headers["set-cookie"]);
  return { status: response.statusCode, cookie, json: response.json<SignupResponse>() };
}

before(async () => {
  const context = fakeContext({
    provisionAccount: async (account) => {
      provisioned.push(account);
      if (account.role === "public_body") return undefined;
      const wallet = Wallet.generate();
      managedWallets.set(wallet.address, wallet);
      return { address: wallet.address, seed: wallet.seed ?? "" };
    },
  });
  app = await buildApp({ host: "127.0.0.1", port: 0, corsOrigins: [], stateFile: "" }, context);
  app.get("/test/lender-only", { preHandler: requireRole(context, "lender") }, async () => ({ ok: true }));
  await app.ready();
});

after(() => app.close());

describe("POST /api/auth/signup", () => {
  test("prêteur : compte ouvert, cookie de session httpOnly, aucune seed renvoyée", async () => {
    const response = await app.inject({ method: "POST", url: "/api/auth/signup", payload: lenderSignup });
    assert.equal(response.statusCode, HTTP_CREATED);
    const header = String(response.headers["set-cookie"]);
    assert.match(header, /^bari_session=[^;]+/);
    assert.match(header, /HttpOnly/);
    assert.match(header, /SameSite=Lax/);
    assert.match(header, new RegExp(`Max-Age=${SESSION_MAX_AGE_S}`));

    const { user } = response.json<SignupResponse>();
    assert.equal(user.email, "alice@example.com");
    assert.equal(user.role, "lender");
    assert.ok(user.address !== undefined && managedWallets.has(user.address));
    assert.equal(user.verification, "basic (self-declared)");
    for (const wallet of managedWallets.values()) assert.ok(!response.body.includes(wallet.seed ?? "?"));
    assert.ok(!response.body.includes(PASSWORD));
    assert.deepEqual(provisioned.at(-1), { role: "lender", profile: { name: "Alice Rossi", country: "IT" } });
  });

  test("email déjà pris → 409", async () => {
    const { status } = await signup({ ...businessSignup, email: "ALICE@example.com", profile: { company: "X", vatNumber: "IT99999999999" } });
    assert.equal(status, HTTP_CONFLICT);
  });

  test("n° de TVA déjà inscrit → 409", async () => {
    assert.equal((await signup(businessSignup)).status, HTTP_CREATED);
    const { status } = await signup({ ...businessSignup, email: "other@example.com" });
    assert.equal(status, HTTP_CONFLICT);
  });

  test("prêteur sans reconnaissance du risque → 400, rien n'est ouvert", async () => {
    const before = provisioned.length;
    const { status } = await signup({
      ...lenderSignup,
      email: "bob@example.com",
      profile: { name: "Bob", country: "IT", riskAcknowledged: false },
    });
    assert.equal(status, HTTP_BAD_REQUEST);
    assert.equal(provisioned.length, before);
  });

  test("champ hors du formulaire → 400", async () => {
    const { status } = await signup({ ...lenderSignup, email: "carol@example.com", seed: "x" });
    assert.equal(status, HTTP_BAD_REQUEST);
  });

  test("organisme public : nom repris du registre, sans compte XRPL ; organisme inconnu → 400", async () => {
    const created = await signup({
      email: "ragioneria@comune.bari.it",
      password: PASSWORD,
      role: "public_body",
      profile: { ipaCode: "c_a662" },
    });
    assert.equal(created.status, HTTP_CREATED);
    assert.deepEqual(created.json.user.profile, { ipaCode: "c_a662", name: "Comune di Bari" });
    assert.equal(created.json.user.address, undefined);

    const unknown = await signup({ email: "x@comune.it", password: PASSWORD, role: "public_body", profile: { ipaCode: "c_zzzz" } });
    assert.equal(unknown.status, HTTP_BAD_REQUEST);
  });
});

describe("session", () => {
  test("inscription → cookie → GET /api/me", async () => {
    const { cookie } = await signup({ ...lenderSignup, email: "dora@example.com" });
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie } });
    assert.equal(me.statusCode, HTTP_OK);
    assert.equal(me.json<AccountView>().email, "dora@example.com");
  });

  test("sans cookie, ou cookie falsifié → 401", async () => {
    assert.equal((await app.inject({ method: "GET", url: "/api/me" })).statusCode, HTTP_UNAUTHORIZED);
    const { cookie } = await signup({ ...lenderSignup, email: "eve@example.com" });
    const [name, value] = (cookie ?? "").split("=");
    const forged = `${name}=${value.slice(0, -2)}${value.endsWith("AA") ? "BB" : "AA"}`;
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: forged } });
    assert.equal(me.statusCode, HTTP_UNAUTHORIZED);
  });

  test("connexion : mauvais mot de passe → 401, bon mot de passe → cookie", async () => {
    const wrong = await app.inject({
      method: "POST",
      url: "/api/auth/signin",
      payload: { email: "alice@example.com", password: "not the password" },
    });
    assert.equal(wrong.statusCode, HTTP_UNAUTHORIZED);
    assert.equal(wrong.headers["set-cookie"], undefined);

    const right = await app.inject({
      method: "POST",
      url: "/api/auth/signin",
      payload: { email: "Alice@Example.com", password: PASSWORD },
    });
    assert.equal(right.statusCode, HTTP_OK);
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: sessionCookie(right.headers["set-cookie"]) } });
    assert.equal(me.json<AccountView>().role, "lender");
  });

  test("déconnexion : le cookie est effacé", async () => {
    const response = await app.inject({ method: "POST", url: "/api/auth/signout" });
    assert.equal(response.statusCode, HTTP_NO_CONTENT);
    assert.match(String(response.headers["set-cookie"]), /^bari_session=;.*Max-Age=0/);
  });
});

describe("requireRole", () => {
  test("sans session → 401, autre rôle → 403, bon rôle → 200", async () => {
    assert.equal((await app.inject({ method: "GET", url: "/test/lender-only" })).statusCode, HTTP_UNAUTHORIZED);

    const business = await signup({ ...businessSignup, email: "fabio@example.com", profile: { company: "F", vatNumber: "IT11111111111" } });
    const asBusiness = await app.inject({ method: "GET", url: "/test/lender-only", headers: { cookie: business.cookie } });
    assert.equal(asBusiness.statusCode, HTTP_FORBIDDEN);

    const lender = await signup({ ...lenderSignup, email: "gina@example.com" });
    const asLender = await app.inject({ method: "GET", url: "/test/lender-only", headers: { cookie: lender.cookie } });
    assert.equal(asLender.statusCode, HTTP_OK);
  });
});
