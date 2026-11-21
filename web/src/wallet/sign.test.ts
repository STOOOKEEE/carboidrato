// Signature dans un faux Otsu : blob renvoyé, refus et délai dépassé reconnus, autres erreurs inchangées.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { OtsuProvider } from "./otsu";
import { signWithOtsu, WalletRejected } from "./sign";

const tx = { TransactionType: "TrustSet", Sequence: 7 };

function fakeOtsu(signTransaction: OtsuProvider["signTransaction"]): OtsuProvider {
  return {
    isOtsu: true,
    connect: async () => ({ address: "r1" }),
    getAddress: async () => ({ address: "r1" }),
    getNetwork: async () => ({ network: "custom-1" }),
    signTransaction,
  };
}

describe("signWithOtsu", () => {
  test("la transaction est signée telle quelle et le blob renvoyé", async () => {
    const signed: Record<string, unknown>[] = [];
    const provider = fakeOtsu(async (request) => {
      signed.push(request);
      return { tx_blob: "BLOB", hash: "HASH" };
    });
    assert.equal(await signWithOtsu(provider, tx), "BLOB");
    assert.deepEqual(signed, [tx]);
  });

  test("refus ou délai dépassé dans Otsu → WalletRejected", async () => {
    for (const code of ["USER_REJECTED", "SIGNING_REJECTED", "SIGNING_TIMEOUT"]) {
      const provider = fakeOtsu(async () => {
        throw new Error(code);
      });
      await assert.rejects(signWithOtsu(provider, tx), WalletRejected);
    }
  });

  test("autre erreur gardée telle quelle ; sans Otsu, erreur explicite", async () => {
    const provider = fakeOtsu(async () => {
      throw new Error("Account not found.");
    });
    await assert.rejects(signWithOtsu(provider, tx), /Account not found/);
    await assert.rejects(signWithOtsu(undefined, tx), /not available/);
  });
});
