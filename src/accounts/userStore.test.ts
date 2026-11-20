// Comptes utilisateurs : hachés scrypt, unicité (email, TVA, organisme public), persistance du fichier gitignoré.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { Wallet } from "xrpl";
import { DuplicateUser, UserStore, type NewUser } from "./userStore.js";

const PASSWORD = "correct horse battery";
const OWNER_ONLY = 0o600;
const PERMISSION_BITS = 0o777;

const lender = {
  email: " Alice@Example.COM ",
  password: PASSWORD,
  role: "lender",
  profile: { name: "Alice Rossi", country: "IT" },
} satisfies NewUser;
const business = {
  email: "marco@costruzioni.it",
  password: PASSWORD,
  role: "business",
  profile: { company: "Marco Costruzioni S.r.l.", vatNumber: "it 0123 4567 890" },
} satisfies NewUser;
const publicBody = {
  email: "ragioneria@comune.bari.it",
  password: PASSWORD,
  role: "public_body",
  profile: { ipaCode: "c_a662", name: "Comune di Bari" },
} satisfies NewUser;
const wallet = Wallet.generate();
const managed = { address: wallet.address, seed: wallet.seed ?? "" };

function freshFile(): string {
  return join(mkdtempSync(join(tmpdir(), "bari-users-")), "users.json");
}

describe("UserStore", () => {
  test("inscription puis connexion : email normalisé, mot de passe vérifié", async () => {
    const store = new UserStore(freshFile());
    const created = await store.create(lender, managed);
    assert.equal(created.email, "alice@example.com");
    assert.equal(created.role, "lender");
    assert.deepEqual(created.account, managed);

    const signedIn = await store.authenticate("ALICE@example.com", PASSWORD);
    assert.equal(signedIn?.id, created.id);
    assert.equal(store.findById(created.id)?.email, "alice@example.com");
  });

  test("mauvais mot de passe ou email inconnu → aucun utilisateur", async () => {
    const store = new UserStore(freshFile());
    await store.create(lender, managed);
    assert.equal(await store.authenticate(lender.email, "wrong password"), undefined);
    assert.equal(await store.authenticate("nobody@example.com", PASSWORD), undefined);
  });

  test("email déjà pris, à la casse et aux espaces près", async () => {
    const store = new UserStore(freshFile());
    await store.create(lender, managed);
    const again: NewUser = { ...business, email: "alice@EXAMPLE.com" };
    assert.throws(() => store.assertAvailable(again), (error) => error instanceof DuplicateUser && error.field === "email");
    await assert.rejects(store.create(again, managed), DuplicateUser);
  });

  test("n° de TVA unique entre entreprises, normalisé (majuscules, sans espaces)", async () => {
    const store = new UserStore(freshFile());
    const created = await store.create(business, managed);
    assert.equal(created.role === "business" && created.profile.vatNumber, "IT01234567890");
    const sameVat: NewUser = { ...business, email: "other@example.com", profile: { company: "Other", vatNumber: "IT01234567890" } };
    assert.throws(
      () => store.assertAvailable(sameVat),
      (error) => error instanceof DuplicateUser && error.field === "vatNumber",
    );
    assert.equal(store.findBusinessByVat("it01234567890")?.id, created.id);
  });

  test("un seul compte par organisme public", async () => {
    const store = new UserStore(freshFile());
    const created = await store.create(publicBody, undefined);
    assert.equal(created.account, undefined);
    assert.deepEqual(created.profile, { ipaCode: "c_a662", name: "Comune di Bari" });
    const second: NewUser = { ...publicBody, email: "protocollo@comune.bari.it" };
    assert.throws(
      () => store.assertAvailable(second),
      (error) => error instanceof DuplicateUser && error.field === "publicBody",
    );
  });

  test("fichier relu par une nouvelle instance : mêmes comptes, même secret de session, aucun mot de passe en clair", async () => {
    const file = freshFile();
    const store = new UserStore(file);
    await store.create(lender, managed);
    const reloaded = new UserStore(file);
    assert.ok(await reloaded.authenticate(lender.email, PASSWORD));
    assert.ok(reloaded.sessionSecret.equals(store.sessionSecret));
    assert.ok(store.sessionSecret.length >= 32);

    const raw = readFileSync(file, "utf8");
    assert.ok(!raw.includes(PASSWORD));
    assert.equal(statSync(file).mode & PERMISSION_BITS, OWNER_ONLY);
  });
});
