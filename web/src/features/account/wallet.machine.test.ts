// Connexion par wallet : parcours complet avec un faux Otsu et une fausse API, erreurs et leur solution.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { WALLET_SIGNIN_MEMO_TYPE, type AccountView, type WalletVerifyResponse } from "../../../../src/api/contract";
import type { OtsuProvider } from "../../wallet/otsu";
import { challengeTransaction, failureHelp, signInWithWallet, type WalletDeps, type WalletStep } from "./wallet.machine";

const ADDRESS = "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY";
const NONCE = "AB".repeat(32);
const NOW = Date.parse("2026-11-21T10:00:00Z");
const EXPIRES_AT = "2026-11-21T10:05:00Z";
const network = { networkId: 1000, wsUrl: "wss://node.example" };
const user: AccountView = {
  custody: "wallet",
  address: ADDRESS,
  verification: "basic (self-declared)",
  role: "lender",
  profile: { name: "Ada", country: "IT" },
};

function fakeOtsu(overrides: Partial<OtsuProvider> = {}): OtsuProvider & { signed: Record<string, unknown>[] } {
  const signed: Record<string, unknown>[] = [];
  return {
    isOtsu: true,
    signed,
    connect: async () => ({ address: ADDRESS }),
    getAddress: async () => ({ address: ADDRESS }),
    getNetwork: async () => ({ network: "custom-1" }),
    signTransaction: async (tx) => {
      signed.push(tx);
      return { tx_blob: "BLOB", hash: "HASH" };
    },
    ...overrides,
  };
}

function deps(overrides: Partial<WalletDeps> = {}): WalletDeps {
  return {
    provider: fakeOtsu(),
    fetchNetwork: async () => network,
    challenge: async () => ({ nonce: NONCE, expiresAt: EXPIRES_AT }),
    verify: async () => ({ status: "signedIn", user }),
    now: () => NOW,
    ...overrides,
  };
}

const rejecting = (message: string) => async () => {
  throw new Error(message);
};

describe("signInWithWallet", () => {
  test("wallet connu : connexion, défi, AccountSet signé avec le nonce en mémo, session", async () => {
    const provider = fakeOtsu();
    const steps: WalletStep[] = [];
    const verified: string[] = [];
    const outcome = await signInWithWallet(
      deps({
        provider,
        verify: async (blob) => {
          verified.push(blob);
          return { status: "signedIn", user };
        },
      }),
      (step) => steps.push(step),
    );
    assert.deepEqual(outcome, { kind: "signedIn", user });
    assert.deepEqual(steps, ["connecting", "preparing", "signing", "verifying"]);
    assert.deepEqual(provider.signed, [challengeTransaction(ADDRESS, NONCE)]);
    assert.deepEqual(verified, ["BLOB"]);
  });

  test("wallet inconnu : jeton d'inscription", async () => {
    const register: WalletVerifyResponse = { status: "register", address: ADDRESS, token: "t" };
    const outcome = await signInWithWallet(deps({ verify: async () => register }), () => undefined);
    assert.deepEqual(outcome, { kind: "register", address: ADDRESS, token: "t" });
  });

  test("Otsu absent → missing", async () => {
    assert.deepEqual(await signInWithWallet(deps({ provider: undefined }), () => undefined), {
      kind: "failed",
      failure: { kind: "missing" },
    });
  });

  test("réseau prédéfini différent → wrongNetwork, sans défi", async () => {
    let challenged = false;
    const outcome = await signInWithWallet(
      deps({
        provider: fakeOtsu({ getNetwork: async () => ({ network: "testnet" }) }),
        challenge: async () => {
          challenged = true;
          return { nonce: NONCE, expiresAt: EXPIRES_AT };
        },
      }),
      () => undefined,
    );
    assert.deepEqual(outcome, { kind: "failed", failure: { kind: "wrongNetwork", wsUrl: network.wsUrl, walletNetwork: "testnet" } });
    assert.equal(challenged, false);
  });

  test("compte introuvable à l'autofill d'Otsu (réseau ajouté à la main, mauvais nœud) → wrongNetwork", async () => {
    const provider = fakeOtsu({ signTransaction: rejecting("Account not found.") });
    assert.deepEqual(await signInWithWallet(deps({ provider }), () => undefined), {
      kind: "failed",
      failure: { kind: "wrongNetwork", wsUrl: network.wsUrl },
    });
  });

  test("refus dans Otsu, à la connexion ou à la signature → rejected", async () => {
    for (const provider of [
      fakeOtsu({ connect: rejecting("SIGNING_REJECTED") }),
      fakeOtsu({ signTransaction: rejecting("USER_REJECTED") }),
      fakeOtsu({ signTransaction: rejecting("SIGNING_TIMEOUT") }),
    ]) {
      assert.deepEqual(await signInWithWallet(deps({ provider }), () => undefined), { kind: "failed", failure: { kind: "rejected" } });
    }
  });

  test("vérification refusée après l'expiration du défi → expired ; avant → message de l'API", async () => {
    const verify = rejecting("This sign-in request expired. Try again.");
    const late = await signInWithWallet(deps({ verify, now: () => Date.parse(EXPIRES_AT) + 1 }), () => undefined);
    assert.deepEqual(late, { kind: "failed", failure: { kind: "expired" } });
    const early = await signInWithWallet(deps({ verify: rejecting("Signed by another account") }), () => undefined);
    assert.deepEqual(early, { kind: "failed", failure: { kind: "error", message: "Signed by another account" } });
  });
});

describe("failureHelp", () => {
  test("chaque erreur dit quoi faire", () => {
    const missing = failureHelp({ kind: "missing" });
    assert.equal(missing.link?.href, "https://github.com/RomThpt/otsu-wallet");
    assert.match(failureHelp({ kind: "wrongNetwork", wsUrl: "wss://node.example" }).fix, /Add custom network → wss:\/\/node\.example$/);
    assert.match(failureHelp({ kind: "wrongNetwork", wsUrl: "wss://node.example", walletNetwork: "testnet" }).message, /testnet/);
    assert.match(failureHelp({ kind: "rejected" }).fix, /approve/i);
    assert.match(failureHelp({ kind: "expired" }).fix, /again/i);
    assert.equal(failureHelp({ kind: "error", message: "Boom" }).message, "Boom");
  });
});

test("challengeTransaction : AccountSet du wallet, nonce en MemoData sous le MemoType de Bari", () => {
  assert.deepEqual(challengeTransaction(ADDRESS, NONCE), {
    TransactionType: "AccountSet",
    Account: ADDRESS,
    Memos: [{ Memo: { MemoType: WALLET_SIGNIN_MEMO_TYPE, MemoData: NONCE } }],
  });
});
