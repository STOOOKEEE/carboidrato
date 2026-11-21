// Identifiant affiché d'un compte : son email, ou l'adresse tronquée de son wallet.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { AccountView } from "../../../../src/api/contract";
import { accountHandle } from "./roles";

const profile = { role: "lender", profile: { name: "Ada", country: "IT" }, verification: "basic (self-declared)" } as const;

test("accountHandle : email d'un compte géré, adresse tronquée d'un wallet", () => {
  const managed: AccountView = { ...profile, custody: "managed", email: "ada@example.com", address: "rManaged" };
  const wallet: AccountView = { ...profile, custody: "wallet", address: "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY" };
  assert.equal(accountHandle(managed), "ada@example.com");
  assert.equal(accountHandle(wallet), "rPEPPE…c6GDY");
});
