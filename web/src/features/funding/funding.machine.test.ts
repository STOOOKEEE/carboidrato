// Tests de la machine d'état du financement PME : chaque transition valide, et les événements ignorés.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { LoanCheck } from "../../../../src/api/contract";
import {
  initialFundingState,
  isFundingBusy,
  transition,
  type FundingCertificate,
  type FundingEvent,
  type FundingLoan,
  type FundingProof,
  type FundingState,
} from "./funding.machine";

const proof: FundingProof = {
  proof: {
    pi_a: ["1", "2", "1"],
    pi_b: [["3", "4"], ["5", "6"], ["1", "0"]],
    pi_c: ["7", "8", "1"],
    protocol: "groth16",
    curve: "bn128",
  },
  publicSignals: ["11", "12"],
};
const passed: LoanCheck[] = [{ id: "kyb", label: "Business KYB verified", ok: true }];
const failedChecks: LoanCheck[] = [
  { id: "kyb", label: "Business KYB verified", ok: true },
  { id: "concentration", label: "Debtor exposure within 20 % of the fund", ok: false, reason: "Exposure above 20 %" },
];
const certificate: FundingCertificate = { txHash: "C3RT", tokenId: "0000ABCD", nullifier: "2A" };
const loan: FundingLoan = {
  txHash: "L0AN",
  loanId: "LOANID",
  principalEur: 9_000,
  feeEur: 45,
  netAdvanceEur: 8_955,
  dueDate: "2027-02-19T00:00:00.000Z",
  checks: passed,
};

const proving: FundingState = { status: "proving" };
const proved: FundingState = { status: "proved", proof, durationMs: 1_200 };
const certifying: FundingState = { status: "certifying", proof, durationMs: 1_200 };
const certified: FundingState = { status: "certified", durationMs: 1_200, certificate };
const underwriting: FundingState = { status: "underwriting", durationMs: 1_200, certificate };
const funded: FundingState = { status: "funded", durationMs: 1_200, certificate, loan };
const refused: FundingState = {
  status: "refused",
  durationMs: 1_200,
  certificate,
  reason: "Exposure above 20 %",
  checks: failedChecks,
};
const duplicate: FundingState = { status: "duplicate", txHash: "D0UBLE" };
const failedFromProved: FundingState = { status: "error", message: "ledger timeout", retry: proved };

const ALL_EVENTS: FundingEvent[] = [
  { type: "PROVE" },
  { type: "PROVED", proof, durationMs: 1_200 },
  { type: "CERTIFY" },
  { type: "CERTIFIED", certificate },
  { type: "UNDERWRITE" },
  { type: "FUNDED", loan },
  { type: "REFUSED", reason: "Exposure above 20 %", checks: failedChecks },
  { type: "DUPLICATE", txHash: "D0UBLE" },
  { type: "FAILED", message: "boom" },
  { type: "RETRY" },
  { type: "RESET" },
];

function assertIgnores(state: FundingState, accepted: FundingEvent["type"][]): void {
  for (const event of ALL_EVENTS.filter((candidate) => !accepted.includes(candidate.type))) {
    assert.equal(transition(state, event), state, `${state.status} doit ignorer ${event.type}`);
  }
}

describe("funding machine", () => {
  test("starts with an invoice ready to prove", () => {
    assert.deepEqual(initialFundingState, { status: "invoiceReady" });
  });

  describe("invoiceReady", () => {
    test("PROVE starts proving", () => {
      assert.deepEqual(transition(initialFundingState, { type: "PROVE" }), proving);
    });

    test("DUPLICATE when the registry already holds the invoice", () => {
      assert.deepEqual(transition(initialFundingState, { type: "DUPLICATE", txHash: "D0UBLE" }), duplicate);
    });

    test("ignores every other event", () => {
      assertIgnores(initialFundingState, ["PROVE", "DUPLICATE"]);
    });
  });

  describe("proving", () => {
    test("PROVED keeps the proof and the time the browser took", () => {
      assert.deepEqual(transition(proving, { type: "PROVED", proof, durationMs: 1_200 }), proved);
    });

    test("FAILED goes to error, retrying from invoiceReady", () => {
      assert.deepEqual(transition(proving, { type: "FAILED", message: "witness rejected" }), {
        status: "error",
        message: "witness rejected",
        retry: initialFundingState,
      });
    });

    test("ignores every other event", () => {
      assertIgnores(proving, ["PROVED", "FAILED"]);
    });
  });

  describe("proved", () => {
    test("CERTIFY keeps the proof while certifying", () => {
      assert.deepEqual(transition(proved, { type: "CERTIFY" }), certifying);
    });

    test("ignores every other event", () => {
      assertIgnores(proved, ["CERTIFY"]);
    });
  });

  describe("certifying", () => {
    test("CERTIFIED records the certificate and keeps the proof duration", () => {
      assert.deepEqual(transition(certifying, { type: "CERTIFIED", certificate }), certified);
    });

    test("DUPLICATE when the ledger already holds N", () => {
      assert.deepEqual(transition(certifying, { type: "DUPLICATE", txHash: "D0UBLE" }), duplicate);
    });

    test("FAILED goes to error, retrying from proved", () => {
      assert.deepEqual(transition(certifying, { type: "FAILED", message: "ledger timeout" }), failedFromProved);
    });

    test("ignores every other event", () => {
      assertIgnores(certifying, ["CERTIFIED", "DUPLICATE", "FAILED"]);
    });
  });

  describe("certified", () => {
    test("UNDERWRITE asks Bari for the loan", () => {
      assert.deepEqual(transition(certified, { type: "UNDERWRITE" }), underwriting);
    });

    test("ignores every other event", () => {
      assertIgnores(certified, ["UNDERWRITE"]);
    });
  });

  describe("underwriting", () => {
    test("FUNDED records the loan", () => {
      assert.deepEqual(transition(underwriting, { type: "FUNDED", loan }), funded);
    });

    test("REFUSED keeps the reason, every check and the certificate", () => {
      assert.deepEqual(
        transition(underwriting, { type: "REFUSED", reason: "Exposure above 20 %", checks: failedChecks }),
        refused,
      );
    });

    test("FAILED goes to error, retrying from certified", () => {
      assert.deepEqual(transition(underwriting, { type: "FAILED", message: "api down" }), {
        status: "error",
        message: "api down",
        retry: certified,
      });
    });

    test("ignores every other event", () => {
      assertIgnores(underwriting, ["FUNDED", "REFUSED", "FAILED"]);
    });
  });

  describe("terminal states", () => {
    for (const state of [funded, refused, duplicate]) {
      test(`${state.status}: RESET returns to invoiceReady`, () => {
        assert.equal(transition(state, { type: "RESET" }), initialFundingState);
      });

      test(`${state.status}: ignores every other event`, () => {
        assertIgnores(state, ["RESET"]);
      });
    }
  });

  describe("error", () => {
    test("RETRY returns to the step before the failure", () => {
      assert.equal(transition(failedFromProved, { type: "RETRY" }), proved);
    });

    test("RETRY after a failed proof returns to invoiceReady", () => {
      const failed = transition(proving, { type: "FAILED", message: "witness rejected" });
      assert.equal(transition(failed, { type: "RETRY" }), initialFundingState);
    });

    test("RESET abandons the flow", () => {
      assert.equal(transition(failedFromProved, { type: "RESET" }), initialFundingState);
    });

    test("ignores every other event", () => {
      assertIgnores(failedFromProved, ["RETRY", "RESET"]);
    });
  });

  test("busy from the proof until Bari answers", () => {
    const busy = [proving, proved, certifying, certified, underwriting].map(isFundingBusy);
    const idle = [initialFundingState, funded, refused, duplicate, failedFromProved].map(isFundingBusy);
    assert.deepEqual(busy, [true, true, true, true, true]);
    assert.deepEqual(idle, [false, false, false, false, false]);
  });
});
