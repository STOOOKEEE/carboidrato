// Tests des comptes du pitch : définitions, réutilisation par email, conflits signalés, fichier des identifiants.

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { Wallet } from "xrpl";
import { UserStore, type NewUser } from "../accounts/userStore.js";
import {
  generatePassword,
  parsePitchCredentials,
  PITCH_ACCOUNTS,
  planPitchAccount,
  releasePitchBusiness,
  renderPitchCredentials,
  shortAddress,
} from "./pitchAccounts.js";
import { PITCH_SUPPLIER } from "./sampleInvoices.js";

const wallet = Wallet.generate();
const managed = { address: wallet.address, seed: wallet.seed ?? "" };

function usersFile(): string {
  return join(mkdtempSync(join(tmpdir(), "bari-pitch-")), "users.json");
}

function freshStore(): UserStore {
  return new UserStore(usersFile());
}

const otsuSupplier = {
  role: "business",
  profile: { company: PITCH_SUPPLIER.name, vatNumber: PITCH_SUPPLIER.vatNumber },
  address: Wallet.generate().address,
} as const;

function account(role: string) {
  const found = PITCH_ACCOUNTS.find((candidate) => candidate.role === role);
  assert.ok(found);
  return found;
}

describe("PITCH_ACCOUNTS", () => {
  test("un prêteur, le fournisseur des factures du pitch et la Comune di Bari", () => {
    assert.deepEqual(
      PITCH_ACCOUNTS.map(({ role }) => role),
      ["lender", "business", "public_body"],
    );
    const business = account("business");
    assert.deepEqual(business.role === "business" && business.profile, {
      company: PITCH_SUPPLIER.name,
      vatNumber: "IT07543210723",
    });
    const body = account("public_body");
    assert.deepEqual(body.role === "public_body" && body.profile, { ipaCode: "c_a662", name: "Comune di Bari" });
    assert.equal(new Set(PITCH_ACCOUNTS.map(({ email }) => email)).size, PITCH_ACCOUNTS.length);
  });
});

describe("planPitchAccount", () => {
  test("absent du fichier des comptes → à créer", () => {
    assert.deepEqual(planPitchAccount(account("lender"), freshStore()), { action: "create" });
  });

  test("même email et même rôle → réutilisé", async () => {
    const store = freshStore();
    const lender = account("lender");
    const user = await store.create({ ...lender, password: "password-1" } as NewUser, managed);
    assert.deepEqual(planPitchAccount(lender, store), { action: "reuse", user });
  });

  test("email pris par un autre rôle → conflit", async () => {
    const store = freshStore();
    const lender = account("lender");
    await store.create({ ...account("business"), email: lender.email, password: "password-1" } as NewUser, managed);
    const plan = planPitchAccount(lender, store);
    assert.equal(plan.action, "conflict");
  });

  test("Comune di Bari déjà inscrite sous un autre email → conflit qui nomme cet email", async () => {
    const store = freshStore();
    const body = account("public_body");
    await store.create({ ...body, email: "other@comune.example", password: "password-1" } as NewUser, undefined);
    const plan = planPitchAccount(body, store);
    assert.equal(plan.action, "conflict");
    assert.match(plan.action === "conflict" ? plan.reason : "", /other@comune\.example/);
  });

  test("TVA du fournisseur déjà inscrite sous un autre email → conflit qui nomme cet email", async () => {
    const store = freshStore();
    const business = account("business");
    await store.create({ ...business, email: "other@sparano.example", password: "password-1" } as NewUser, managed);
    const plan = planPitchAccount(business, store);
    assert.equal(plan.action, "conflict");
    assert.match(plan.action === "conflict" ? plan.reason : "", /other@sparano\.example/);
  });

  test("TVA du fournisseur ouverte avec un wallet Otsu → le compte du pitch est ce wallet", () => {
    const store = freshStore();
    const user = store.createWalletUser(otsuSupplier);
    assert.deepEqual(planPitchAccount(account("business"), store), { action: "wallet", user });
  });
});

describe("releasePitchBusiness", () => {
  test("compte email du fournisseur sans prêt en cours → supprimé du fichier, TVA libre pour un wallet", async () => {
    const file = usersFile();
    const store = new UserStore(file);
    const business = account("business");
    const user = await store.create({ ...business, password: "password-1" } as NewUser, managed);
    assert.deepEqual(releasePitchBusiness(store, new Set()), user);
    const reloaded = new UserStore(file);
    assert.equal(reloaded.findByEmail(business.email), undefined);
    assert.equal(reloaded.createWalletUser(otsuSupplier).address, otsuSupplier.address);
  });

  test("aucun compte email du fournisseur → rien à libérer", () => {
    assert.equal(releasePitchBusiness(freshStore(), new Set()), undefined);
  });

  test("prêt en cours sur son compte → refus, le compte reste", async () => {
    const store = freshStore();
    const business = account("business");
    await store.create({ ...business, password: "password-1" } as NewUser, managed);
    assert.throws(() => releasePitchBusiness(store, new Set([managed.address])), /active loan/);
    assert.ok(store.findByEmail(business.email));
  });
});

describe("identifiants du pitch", () => {
  test("rendu puis relecture : email → mot de passe", () => {
    const entries = PITCH_ACCOUNTS.map(({ email, role }, index) => ({ email, role, password: `pass-${index}-xyz` }));
    const parsed = parsePitchCredentials(renderPitchCredentials(entries));
    assert.deepEqual([...parsed.entries()], entries.map(({ email, password }) => [email, password]));
  });

  test("fichier sans tableau → aucun identifiant", () => {
    assert.equal(parsePitchCredentials("# rien\n").size, 0);
  });

  test("mot de passe aléatoire, accepté par l'inscription (8 à 128 caractères), sans barre verticale", () => {
    const first = generatePassword();
    assert.notEqual(first, generatePassword());
    assert.ok(first.length >= 8 && first.length <= 128);
    assert.doesNotMatch(first, /[|\s]/);
  });
});

describe("shortAddress", () => {
  test("début et fin de l'adresse XRPL", () => {
    assert.equal(shortAddress("rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe"), "rPT1Sj…zbpAYe");
  });
});
