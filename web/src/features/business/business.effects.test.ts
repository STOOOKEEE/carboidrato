// Tests des effets de « Get paid now » : réponses de l'API lues en issues typées, étape suivante du financement,
// signatures dans Otsu d'une entreprise wallet.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type {
  CertificateResponse,
  LoanRefusal,
  LoanResponse,
  LoanSignature,
  PreparedSignature,
  RegistryLookup,
} from "../../../../src/api/contract";
import { WalletRejected } from "../../wallet/sign";
import type { FundingLoan, FundingProof, FundingState } from "../funding/funding.machine";
import {
  certificateOutcome,
  loanOutcome,
  nextFundingEvent,
  OTSU_DECLINED,
  type CertificateOutcome,
  type FundingServices,
  type LoanOutcome,
} from "./business.effects";

const proof: FundingProof = {
  proof: { pi_a: ["1"], pi_b: [["2"]], pi_c: ["3"], protocol: "groth16", curve: "bn128" },
  publicSignals: ["4"],
};
const certificateResponse: CertificateResponse = {
  tokenId: "0000ABCD",
  nullifier: "2A",
  pseudonym: "50",
  commitment: "C0",
  proofSystem: "groth16",
  transactions: [
    { label: "Batch certificat (tfAllOrNothing)", hash: "BATCH", result: "tesSUCCESS" },
    { label: "CredentialCreate registre N", hash: "INNER", result: "tesSUCCESS" },
  ],
};
const loanResponse: LoanResponse = {
  loanId: "LOANID",
  tokenId: "0000ABCD",
  checks: [{ id: "kyb", label: "Business KYB verified", ok: true }],
  principal: "9000000000",
  originationFee: "45000000",
  netAdvance: "8955000000",
  dueDate: "2027-02-18T00:00:00.000Z",
  txHash: "LOANSET",
  transactions: [],
};
const refusal: LoanRefusal = {
  error: "Exposure above 20 %",
  checks: [{ id: "concentration", label: "Debtor exposure", ok: false, reason: "Exposure above 20 %" }],
  transactions: [],
};
const certificate = { txHash: "BATCH", tokenId: "0000ABCD", nullifier: "2A" };
const fundedLoan: FundingLoan = {
  txHash: "LOANSET",
  loanId: "LOANID",
  principalRlusd: 9_000,
  feeRlusd: 45,
  netAdvanceRlusd: 8_955,
  dueDate: "2027-02-18T00:00:00.000Z",
  checks: loanResponse.checks,
};

describe("certificateOutcome", () => {
  test("201 : certificat émis, lien vers le Batch", () => {
    assert.deepEqual(certificateOutcome(201, certificateResponse), { kind: "issued", certificate });
  });

  test("sans Batch, la première transaction de l'opération", () => {
    const sequential = { ...certificateResponse, transactions: certificateResponse.transactions.slice(1) };
    assert.deepEqual(certificateOutcome(201, sequential), { kind: "issued", certificate: { ...certificate, txHash: "INNER" } });
  });

  test("409 : déjà enregistré, avec la transaction refusée", () => {
    assert.deepEqual(certificateOutcome(409, { error: "Invoice already registered", hash: "REJECTED" }), {
      kind: "duplicate",
      rejectedBy: "REJECTED",
    });
    assert.deepEqual(certificateOutcome(409, { error: "Invoice already registered" }), { kind: "duplicate" });
  });

  test("toute autre réponse : un message qui dit quoi faire", () => {
    assert.deepEqual(certificateOutcome(422, { error: "Proof rejected" }), { kind: "failed", message: "Proof rejected" });
    const unreachable = certificateOutcome(502, undefined);
    assert.equal(unreachable.kind, "failed");
    assert.match(unreachable.kind === "failed" ? unreachable.message : "", /HTTP 502.*try again/i);
    assert.equal(certificateOutcome(201, { ...certificateResponse, transactions: [] }).kind, "failed");
  });
});

describe("loanOutcome", () => {
  test("201 : prêt co-signé, montants en RLUSD", () => {
    assert.deepEqual(loanOutcome(201, loanResponse), { kind: "funded", loan: fundedLoan });
  });

  test("422 avec les contrôles : refus de Bari", () => {
    assert.deepEqual(loanOutcome(422, refusal), { kind: "refused", reason: "Exposure above 20 %", checks: refusal.checks });
  });

  test("422 sans contrôles ou autre statut : échec", () => {
    assert.deepEqual(loanOutcome(422, { error: "Vault closed" }), { kind: "failed", message: "Vault closed" });
    assert.equal(loanOutcome(500, undefined).kind, "failed");
  });
});

function services(overrides: Partial<FundingServices> = {}): FundingServices & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    prove: async () => {
      calls.push("prove");
      return { ...proof, durationMs: 1_200 };
    },
    certify: async (request): Promise<CertificateOutcome> => {
      calls.push(`certify ${Object.keys(request).sort().join(",")}`);
      return { kind: "issued", certificate };
    },
    registration: async (): Promise<RegistryLookup> => {
      calls.push("registration");
      return { registered: true, txHash: "REGISTRATION" };
    },
    borrow: async (tokenId): Promise<LoanOutcome> => {
      calls.push(`borrow ${tokenId}`);
      return loanOutcome(201, loanResponse);
    },
    sign: async (tx) => {
      calls.push(`sign ${String(tx.TransactionType)}`);
      return "S1GNED";
    },
    submitCertificate: async (txBlob) => {
      calls.push(`submitCertificate ${txBlob}`);
      return certificateOutcome(201, certificateResponse);
    },
    submitLoan: async (txBlob) => {
      calls.push(`submitLoan ${txBlob}`);
      return loanOutcome(201, loanResponse);
    },
    ...overrides,
  };
}

describe("nextFundingEvent", () => {
  test("proving : la preuve du navigateur et sa durée", async () => {
    const deps = services();
    assert.deepEqual(await nextFundingEvent({ status: "proving" }, deps), { type: "PROVED", proof, durationMs: 1_200 });
    assert.deepEqual(deps.calls, ["prove"]);
  });

  test("proving : une preuve impossible devient FAILED", async () => {
    const deps = services({
      prove: async () => {
        throw new Error("The debtor is not on Atlas's verified list");
      },
    });
    assert.deepEqual(await nextFundingEvent({ status: "proving" }, deps), {
      type: "FAILED",
      message: "The debtor is not on Atlas's verified list",
    });
  });

  test("étapes enchaînées sans appel : CERTIFY puis UNDERWRITE", async () => {
    const deps = services();
    assert.deepEqual(await nextFundingEvent({ status: "proved", proof, durationMs: 1 }, deps), { type: "CERTIFY" });
    assert.deepEqual(await nextFundingEvent({ status: "certified", durationMs: 1, certificate }, deps), { type: "UNDERWRITE" });
    assert.deepEqual(deps.calls, []);
  });

  test("certifying : seule la preuve et ses signaux publics partent", async () => {
    const deps = services();
    assert.deepEqual(await nextFundingEvent({ status: "certifying", proof, durationMs: 1 }, deps), { type: "CERTIFIED", certificate });
    assert.deepEqual(deps.calls, ["certify proof,publicSignals"]);
  });

  test("certifying : 409 → DUPLICATE avec la transaction d'enregistrement de N", async () => {
    const deps = services({ certify: async () => ({ kind: "duplicate", rejectedBy: "REJECTED" }) });
    assert.deepEqual(await nextFundingEvent({ status: "certifying", proof, durationMs: 1 }, deps), {
      type: "DUPLICATE",
      txHash: "REGISTRATION",
    });
  });

  test("certifying : registre muet → la transaction refusée par le ledger", async () => {
    const deps = services({
      certify: async () => ({ kind: "duplicate", rejectedBy: "REJECTED" }),
      registration: async () => ({ registered: false }),
    });
    assert.deepEqual(await nextFundingEvent({ status: "certifying", proof, durationMs: 1 }, deps), {
      type: "DUPLICATE",
      txHash: "REJECTED",
    });
  });

  test("certifying : doublon sans aucune transaction connue → FAILED", async () => {
    const deps = services({ certify: async () => ({ kind: "duplicate" }), registration: async () => ({ registered: false }) });
    const event = await nextFundingEvent({ status: "certifying", proof, durationMs: 1 }, deps);
    assert.equal(event?.type, "FAILED");
  });

  test("certifying : échec ou réseau coupé → FAILED", async () => {
    const failed = services({ certify: async () => ({ kind: "failed", message: "Proof rejected" }) });
    assert.deepEqual(await nextFundingEvent({ status: "certifying", proof, durationMs: 1 }, failed), {
      type: "FAILED",
      message: "Proof rejected",
    });
    const offline = services({
      certify: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    assert.deepEqual(await nextFundingEvent({ status: "certifying", proof, durationMs: 1 }, offline), {
      type: "FAILED",
      message: "Failed to fetch",
    });
  });

  test("underwriting : prêt du MPT facture, refus ou échec", async () => {
    const underwriting: FundingState = { status: "underwriting", durationMs: 1, certificate };
    const funded = services();
    assert.deepEqual(await nextFundingEvent(underwriting, funded), { type: "FUNDED", loan: fundedLoan });
    assert.deepEqual(funded.calls, ["borrow 0000ABCD"]);
    const refused = services({ borrow: async () => loanOutcome(422, refusal) });
    assert.deepEqual(await nextFundingEvent(underwriting, refused), {
      type: "REFUSED",
      reason: "Exposure above 20 %",
      checks: refusal.checks,
    });
    const failed = services({ borrow: async () => ({ kind: "failed", message: "Vault closed" }) });
    assert.deepEqual(await nextFundingEvent(underwriting, failed), { type: "FAILED", message: "Vault closed" });
  });

  test("états stables : rien à faire", async () => {
    const deps = services();
    for (const state of [
      { status: "invoiceReady" },
      { status: "duplicate", txHash: "D" },
      { status: "error", message: "m", retry: { status: "invoiceReady" }, failedAt: "proving" },
    ] as FundingState[]) {
      assert.equal(await nextFundingEvent(state, deps), undefined);
    }
    assert.deepEqual(deps.calls, []);
  });
});

describe("entreprise wallet : signatures dans Otsu", () => {
  const batchTx = { TransactionType: "Batch", Account: "rWANDA" };
  const loanSetTx = { TransactionType: "LoanSet", Account: "rWANDA" };
  const certificateSignature: PreparedSignature = { status: "sign", tx: batchTx, labels: ["Register"], transactions: [] };
  const loanSignature: LoanSignature = { status: "sign", tx: loanSetTx, labels: ["Borrow"], transactions: [], checks: loanResponse.checks };
  const signingCertificate: FundingState = { status: "signingCertificate", proof, durationMs: 1, tx: batchTx };
  const signingLoan: FundingState = { status: "signingLoan", durationMs: 1, certificate, checks: loanResponse.checks, tx: loanSetTx };

  test("200 avec une transaction à signer : le Batch du certificat, puis le LoanSet et les contrôles de Bari", () => {
    assert.deepEqual(certificateOutcome(200, certificateSignature), { kind: "sign", tx: batchTx });
    assert.deepEqual(loanOutcome(200, loanSignature), { kind: "sign", tx: loanSetTx, checks: loanResponse.checks });
  });

  test("certifying puis underwriting : Bari renvoie la transaction à signer", async () => {
    const deps = services({
      certify: async () => certificateOutcome(200, certificateSignature),
      borrow: async () => loanOutcome(200, loanSignature),
    });
    assert.deepEqual(await nextFundingEvent({ status: "certifying", proof, durationMs: 1 }, deps), {
      type: "SIGN_CERTIFICATE",
      tx: batchTx,
    });
    assert.deepEqual(await nextFundingEvent({ status: "underwriting", durationMs: 1, certificate }, deps), {
      type: "SIGN_LOAN",
      tx: loanSetTx,
      checks: loanResponse.checks,
    });
  });

  test("signing : Otsu signe la transaction telle quelle, sans la soumettre", async () => {
    const deps = services();
    assert.deepEqual(await nextFundingEvent(signingCertificate, deps), { type: "SIGNED", txBlob: "S1GNED" });
    assert.deepEqual(await nextFundingEvent(signingLoan, deps), { type: "SIGNED", txBlob: "S1GNED" });
    assert.deepEqual(deps.calls, ["sign Batch", "sign LoanSet"]);
  });

  test("signing : refus dans Otsu → FAILED qui dit comment continuer", async () => {
    const deps = services({
      sign: async () => {
        throw new WalletRejected();
      },
    });
    assert.deepEqual(await nextFundingEvent(signingLoan, deps), { type: "FAILED", message: OTSU_DECLINED });
    assert.match(OTSU_DECLINED, /declined in Otsu.*Try again/);
    const missing = services({
      sign: async () => {
        throw new Error("Otsu wallet is not available in this browser.");
      },
    });
    assert.deepEqual(await nextFundingEvent(signingCertificate, missing), {
      type: "FAILED",
      message: "Otsu wallet is not available in this browser.",
    });
  });

  test("submitting : le blob signé repart vers Bari, réponses lues comme pour un compte géré", async () => {
    const deps = services();
    assert.deepEqual(await nextFundingEvent({ status: "submittingCertificate", proof, durationMs: 1, txBlob: "B10B" }, deps), {
      type: "CERTIFIED",
      certificate,
    });
    const submittingLoan: FundingState = { status: "submittingLoan", durationMs: 1, certificate, checks: [], txBlob: "L0B" };
    assert.deepEqual(await nextFundingEvent(submittingLoan, deps), { type: "FUNDED", loan: fundedLoan });
    assert.deepEqual(deps.calls, ["submitCertificate B10B", "submitLoan L0B"]);

    const duplicate = services({ submitCertificate: async () => ({ kind: "duplicate", rejectedBy: "REJECTED" }) });
    assert.deepEqual(await nextFundingEvent({ status: "submittingCertificate", proof, durationMs: 1, txBlob: "B10B" }, duplicate), {
      type: "DUPLICATE",
      txHash: "REGISTRATION",
    });
    const refused = services({ submitLoan: async () => loanOutcome(422, refusal) });
    assert.deepEqual(await nextFundingEvent(submittingLoan, refused), {
      type: "REFUSED",
      reason: "Exposure above 20 %",
      checks: refusal.checks,
    });
  });
});
