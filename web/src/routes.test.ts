// Tests des routes de l'app : lecture du hash et garde des espaces selon la session.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AccountView, UserRole } from "../../src/api/contract";
import { guardRoute, parseRoute, signupRoute, spaceRoute, type Route } from "./routes";

const lender: AccountView = {
  email: "ada@example.com",
  custody: "managed",
  role: "lender",
  verification: "basic (self-declared)",
  address: "rLender",
  profile: { name: "Ada", country: "IT" },
};
const business: AccountView = {
  email: "ops@acme.it",
  custody: "managed",
  role: "business",
  verification: "basic (self-declared)",
  address: "rBusiness",
  profile: { company: "Acme Srl", vatNumber: "IT01234567890" },
};

describe("parseRoute", () => {
  test("la landing pour un hash vide, la racine et toute route inconnue", () => {
    for (const hash of ["", "#", "#/", "#/app", "#simulate", "#/signup/admin", "#/lend/extra"]) {
      assert.deepEqual(parseRoute(hash), { page: "landing" }, hash);
    }
  });

  test("connexion, inscription par rôle, Transparency et transaction", () => {
    assert.deepEqual(parseRoute("#/signin"), { page: "signin" });
    assert.deepEqual(parseRoute("#/signup/lender"), { page: "signup", role: "lender" });
    assert.deepEqual(parseRoute("#/signup/business"), { page: "signup", role: "business" });
    assert.deepEqual(parseRoute("#/signup/public_body"), { page: "signup", role: "public_body" });
    assert.deepEqual(parseRoute("#/transparency"), { page: "transparency" });
    assert.deepEqual(parseRoute(`#/tx/${"A".repeat(64)}`), { page: "tx", hash: "A".repeat(64) });
  });

  test("chaque espace correspond à un rôle, aller-retour avec spaceRoute et signupRoute", () => {
    const roles: UserRole[] = ["lender", "business", "public_body"];
    assert.deepEqual(roles.map(spaceRoute), ["#/lend", "#/business", "#/public"]);
    for (const role of roles) {
      assert.deepEqual(parseRoute(spaceRoute(role)), { page: "space", role });
      assert.deepEqual(parseRoute(signupRoute(role)), { page: "signup", role });
    }
  });
});

describe("guardRoute", () => {
  const lendSpace: Route = { page: "space", role: "lender" };

  test("les pages publiques s'affichent quelle que soit la session", () => {
    for (const route of [{ page: "landing" }, { page: "transparency" }, { page: "tx", hash: "AB" }] as Route[]) {
      assert.deepEqual(guardRoute(route, { status: "signedOut" }), { kind: "show" });
      assert.deepEqual(guardRoute(route, { status: "loading" }), { kind: "show" });
    }
  });

  test("un espace attend la session, puis demande la connexion sans session", () => {
    assert.deepEqual(guardRoute(lendSpace, { status: "loading" }), { kind: "loading" });
    assert.deepEqual(guardRoute(lendSpace, { status: "signedOut" }), { kind: "signin", role: "lender" });
  });

  test("un espace s'ouvre pour son rôle, et s'explique pour un autre rôle", () => {
    assert.deepEqual(guardRoute(lendSpace, { status: "signedIn", user: lender }), { kind: "show" });
    assert.deepEqual(guardRoute(lendSpace, { status: "signedIn", user: business }), {
      kind: "wrongRole",
      required: "lender",
      user: business,
    });
  });

  test("la page de connexion renvoie un compte connecté vers son espace", () => {
    assert.deepEqual(guardRoute({ page: "signin" }, { status: "signedOut" }), { kind: "show" });
    assert.deepEqual(guardRoute({ page: "signin" }, { status: "signedIn", user: business }), {
      kind: "redirect",
      to: "#/business",
    });
  });
});
