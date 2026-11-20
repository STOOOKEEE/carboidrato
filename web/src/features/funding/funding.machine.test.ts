// Tests de la machine d'état du financement PME : chaque transition valide, et les événements ignorés.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  initialFundingState,
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
const certificate: FundingCertificate = { txHash: "C3RT", mptIssuanceId: "0000ABCD", nullifier: "0x2a" };
const loan: FundingLoan = { txHash: "L0AN", loanId: "LOANID", principalEur: 9000 };

const proving: FundingState = { status: "proving", startedAt: 1_000 };
const proved: FundingState = { status: "proved", proof, durationMs: 2_500 };
const certifying: FundingState = { status: "certifying", proof, durationMs: 2_500 };
const certified: FundingState = { status: "certified", proof, certificate };
const underwriting: FundingState = { status: "underwriting", proof, certificate };
const funded: FundingState = { status: "funded", certificate, loan };
const refused: FundingState = { status: "refused", reason: "debtor not allowed" };
const duplicate: FundingState = { status: "duplicate", txHash: "D0UBLE" };
const failedFromProved: FundingState = { status: "error", message: "ledger timeout", retry: proved };

const ALL_EVENTS: FundingEvent[] = [
  { type: "PROVE", startedAt: 1_000 },
  { type: "PROVED", proof, finishedAt: 3_500 },
  { type: "CERTIFY" },
  { type: "CERTIFIED", certificate },
  { type: "UNDERWRITE" },
  { type: "FUNDED", loan },
  { type: "REFUSED", reason: "debtor not allowed" },
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
    test("PROVE starts proving at the given time", () => {
      assert.deepEqual(transition(initialFundingState, { type: "PROVE", startedAt: 1_000 }), proving);
    });

    test("DUPLICATE when the invoice is already financed", () => {
      assert.deepEqual(transition(initialFundingState, { type: "DUPLICATE", txHash: "D0UBLE" }), duplicate);
    });

    test("ignores every other event", () => {
      assertIgnores(initialFundingState, ["PROVE", "DUPLICATE"]);
    });
  });

  describe("proving", () => {
    test("PROVED keeps the proof and its duration", () => {
      assert.deepEqual(transition(proving, { type: "PROVED", proof, finishedAt: 3_500 }), proved);
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
    test("CERTIFIED records the certificate", () => {
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

    test("REFUSED keeps the reason", () => {
      assert.deepEqual(transition(underwriting, { type: "REFUSED", reason: "debtor not allowed" }), refused);
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
});
