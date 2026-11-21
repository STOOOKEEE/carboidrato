// Ouverture d'un compte wallet : préparation par Bari, signature dans un faux Otsu, soumission, étapes affichées et
// erreurs avec leur solution.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { OnboardingPrepareResponse, OnboardingTx } from "../../../../src/api/contract";
import type { OtsuProvider } from "../../wallet/otsu";
import {
  onboardingHelp,
  onboardingSteps,
  openWalletAccount,
  type OnboardingDeps,
  type OnboardingState,
} from "./onboarding.machine";

const ADDRESS = "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY";
const issued: OnboardingTx = { label: "KYC_INVESTOR credential issued by Atlas", hash: "AA" };
const tx = { TransactionType: "Batch", Account: ADDRESS, Sequence: 7 };
const labels = ["Accept your KYC credential", "Open your RLUSD trust line"];
const signedTxs: OnboardingTx[] = [
  { label: labels[0], hash: "B1" },
  { label: labels[1], hash: "B2" },
  { label: "All steps signed at once (Batch)", hash: "B0" },
];
const toSign: OnboardingPrepareResponse = { status: "sign", tx, labels, transactions: [issued] };

function fakeOtsu(signTransaction?: OtsuProvider["signTransaction"]): OtsuProvider & { signed: Record<string, unknown>[] } {
  const signed: Record<string, unknown>[] = [];
  return {
    isOtsu: true,
    signed,
    connect: async () => ({ address: ADDRESS }),
    getAddress: async () => ({ address: ADDRESS }),
    getNetwork: async () => ({ network: "custom-1" }),
    signTransaction:
      signTransaction ??
      (async (request) => {
        signed.push(request);
        return { tx_blob: "SIGNED", hash: "B0" };
      }),
  };
}

function deps(overrides: Partial<OnboardingDeps> = {}): OnboardingDeps {
  return {
    provider: fakeOtsu(),
    prepare: async () => toSign,
    submit: async () => ({ transactions: signedTxs }),
    ...overrides,
  };
}

const rejecting = (message: string) => async () => {
  throw new Error(message);
};

async function run(overrides: Partial<OnboardingDeps> = {}): Promise<{ final: OnboardingState; seen: OnboardingState[] }> {
  const seen: OnboardingState[] = [];
  const final = await openWalletAccount(deps(overrides), (state) => seen.push(state));
  return { final, seen };
}

describe("openWalletAccount", () => {
  test("préparation, credential émis par Bari, signature dans Otsu de la transaction telle quelle, soumission", async () => {
    const provider = fakeOtsu();
    const submitted: string[] = [];
    const { final, seen } = await run({
      provider,
      submit: async (blob) => {
        submitted.push(blob);
        return { transactions: signedTxs };
      },
    });
    assert.deepEqual(seen, [
      { status: "preparing" },
      { status: "signing", done: [issued], pending: labels },
      { status: "submitting", done: [issued], pending: labels },
    ]);
    assert.deepEqual(final, { status: "done", done: [issued, ...signedTxs] });
    assert.deepEqual(provider.signed, [tx]);
    assert.deepEqual(submitted, ["SIGNED"]);
  });

  test("rien à signer → ready, sans ouvrir Otsu", async () => {
    const provider = fakeOtsu();
    const { final } = await run({ provider, prepare: async () => ({ status: "ready", transactions: [] }) });
    assert.deepEqual(final, { status: "ready" });
    assert.deepEqual(provider.signed, []);
  });

  test("refus ou délai dépassé dans Otsu → rejected, rien n'est soumis ; le credential émis reste affiché", async () => {
    for (const message of ["USER_REJECTED", "SIGNING_TIMEOUT"]) {
      let submitted = false;
      const { final } = await run({
        provider: fakeOtsu(rejecting(message)),
        submit: async () => {
          submitted = true;
          return { transactions: [] };
        },
      });
      assert.deepEqual(final, { status: "failed", failure: { kind: "rejected" }, done: [issued] });
      assert.equal(submitted, false);
    }
  });

  test("signée trop tard → expired", async () => {
    const { final } = await run({ submit: rejecting("This request expired before it reached the ledger. Start again.") });
    assert.deepEqual(final, { status: "failed", failure: { kind: "expired" }, done: [issued] });
  });

  test("erreur de l'API ou d'Otsu absent → error avec le message", async () => {
    const { final } = await run({ prepare: rejecting("No fund is open") });
    assert.deepEqual(final, { status: "failed", failure: { kind: "error", message: "No fund is open" }, done: [] });
    const missing = await run({ provider: undefined });
    assert.equal(missing.final.status, "failed");
  });
});

describe("onboardingSteps", () => {
  test("transactions faites avec leur hash, puis celles qui attendent la signature", () => {
    assert.deepEqual(onboardingSteps({ status: "preparing" }), []);
    assert.deepEqual(onboardingSteps({ status: "signing", done: [issued], pending: labels }), [
      { label: issued.label, done: true, hash: "AA" },
      { label: labels[0], done: false, hash: undefined },
      { label: labels[1], done: false, hash: undefined },
    ]);
    assert.deepEqual(
      onboardingSteps({ status: "done", done: [issued, ...signedTxs] }).map((step) => [step.done, step.hash]),
      [
        [true, "AA"],
        [true, "B1"],
        [true, "B2"],
        [true, "B0"],
      ],
    );
    assert.deepEqual(onboardingSteps({ status: "failed", failure: { kind: "rejected" }, done: [issued] }), [
      { label: issued.label, done: true, hash: "AA" },
    ]);
  });
});

describe("onboardingHelp", () => {
  test("chaque erreur dit quoi faire", () => {
    assert.match(onboardingHelp({ kind: "rejected" }).fix, /approve/i);
    assert.match(onboardingHelp({ kind: "expired" }).fix, /again/i);
    assert.equal(onboardingHelp({ kind: "error", message: "Boom" }).message, "Boom");
  });
});
