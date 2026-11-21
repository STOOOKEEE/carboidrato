// Tests de l'espace entreprise : fichier signé, pré-contrôle, offre, étapes du financement et liste des factures.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import type { AttestedInvoiceFile, BusinessInvoice, LoanCheck, PrecheckResponse } from "../../../../src/api/contract";
import type { FundingCertificate, FundingLoan, FundingProof, FundingState } from "../funding/funding.machine";
import {
  businessTransition,
  formatDuration,
  fundingSteps,
  getPaidBlocker,
  initialBusinessState,
  invoiceChecks,
  invoiceRows,
  isBusy,
  readSignedFile,
  type BusinessEvent,
  type BusinessState,
} from "./business.machine";

const file = (
  JSON.parse(readFileSync(new URL("../funding/fixtures/witness.json", import.meta.url), "utf8")) as { file: AttestedInvoiceFile }
).file;
const ACCOUNT = file.attestation.account;
const REGISTRATION_TX = "AB".repeat(32);

const precheck: PrecheckResponse = {
  verdict: "eligible",
  invoice: { number: "FT-2026-0815", debtorName: "Comune di Bari", amountUsd: 10_340, dueDate: "2027-02-18T00:00:00.000Z" },
  checks: [
    { id: "signature", ok: true },
    { id: "debtor", ok: true },
    { id: "network", ok: true },
    { id: "amount", ok: true },
    { id: "dueDate", ok: true },
    { id: "unique", ok: true },
  ],
  kyb: { account: ACCOUNT, done: true },
  nullifier: "2A",
  offer: {
    provenThresholdUsd: 10_000,
    advanceRatePercent: 90,
    principalUsd: 9_000,
    feeUsd: 45,
    netAdvanceUsd: 8_955,
    interestUsd: 133.16,
    interestRatePercent: 6,
    totalCostUsd: 178.16,
    annualCostPercent: 8.1,
    termDays: 90,
    repaymentUsd: 9_133.16,
  },
};
const alreadyFinanced: PrecheckResponse = {
  ...precheck,
  verdict: "rejected",
  checks: precheck.checks.map((check) => (check.id === "unique" ? { ...check, ok: false } : check)),
  registeredBy: REGISTRATION_TX,
  offer: undefined,
};

const proof: FundingProof = {
  proof: { pi_a: ["1"], pi_b: [["2"]], pi_c: ["3"], protocol: "groth16", curve: "bn128" },
  publicSignals: ["4"],
};
const certificate: FundingCertificate = { txHash: "C3RT", tokenId: "0000ABCD", nullifier: "2A" };
const checks: LoanCheck[] = [
  { id: "kyb", label: "Business KYB verified", ok: true },
  { id: "concentration", label: "Debtor exposure within 20 % of the fund", ok: false, reason: "Exposure above 20 %" },
];
const loan: FundingLoan = {
  txHash: "L0AN",
  loanId: "LOANID",
  principalRlusd: 9_000,
  feeRlusd: 45,
  netAdvanceRlusd: 8_955,
  dueDate: "2027-02-18T00:00:00.000Z",
  checks: [checks[0]],
};

const checking: BusinessState = { status: "checking", fileName: "invoice.bari.json" };
const ready: BusinessState = { status: "checked", file, precheck, funding: { status: "invoiceReady" } };
const withFunding = (funding: FundingState): BusinessState => ({ status: "checked", file, precheck, funding });

describe("readSignedFile", () => {
  test("lit un fichier signé pour le compte de la session", () => {
    assert.deepEqual(readSignedFile(JSON.stringify(file), ACCOUNT), { ok: true, file });
  });

  test("refuse un fichier qui n'est pas une facture signée, en disant quoi déposer", () => {
    for (const text of ["%PDF-1.7", JSON.stringify({ format: "other" })]) {
      const result = readSignedFile(text, ACCOUNT);
      assert.equal(result.ok, false);
      assert.match(result.ok ? "" : result.message, /signed PDF/);
    }
  });

  test("refuse une facture signée pour un autre compte", () => {
    const result = readSignedFile(JSON.stringify(file), "rOtherAccount");
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.message, /another business/);
  });
});

describe("businessTransition", () => {
  test("sans fichier, un dépôt lance le contrôle", () => {
    assert.deepEqual(initialBusinessState, { status: "empty" });
    assert.deepEqual(businessTransition(initialBusinessState, { type: "FILE_DROPPED", fileName: "invoice.bari.json" }), checking);
  });

  test("contrôle réussi : l'offre attend « Get paid now »", () => {
    assert.deepEqual(businessTransition(checking, { type: "FILE_CHECKED", file, precheck }), ready);
  });

  test("facture déjà enregistrée : « Already financed » avec la transaction d'enregistrement", () => {
    assert.deepEqual(businessTransition(checking, { type: "FILE_CHECKED", file, precheck: alreadyFinanced }), {
      status: "checked",
      file,
      precheck: alreadyFinanced,
      funding: { status: "duplicate", txHash: REGISTRATION_TX },
    });
  });

  test("fichier illisible : le message explique quoi faire", () => {
    assert.deepEqual(businessTransition(checking, { type: "FILE_REJECTED", message: "Drop the .bari.json file" }), {
      status: "unreadable",
      message: "Drop the .bari.json file",
    });
  });

  test("les événements du financement passent à la machine du financement", () => {
    assert.deepEqual(businessTransition(ready, { type: "FUNDING", event: { type: "PROVE" } }), withFunding({ status: "proving" }));
  });

  test("« Get paid now » est ignoré sur une facture refusée ou sans KYB", () => {
    const rejected: BusinessState = { ...ready, precheck: { ...precheck, verdict: "rejected", offer: undefined } };
    const noKyb: BusinessState = { ...ready, precheck: { ...precheck, kyb: { account: ACCOUNT, done: false } } };
    for (const state of [rejected, noKyb]) {
      assert.equal(businessTransition(state, { type: "FUNDING", event: { type: "PROVE" } }), state);
    }
  });

  test("un nouveau fichier remplace l'offre, le refus ou le résultat, jamais un financement en cours", () => {
    const drop: BusinessEvent = { type: "FILE_DROPPED", fileName: "invoice.bari.json" };
    for (const state of [ready, withFunding({ status: "funded", durationMs: 1, certificate, loan }), { status: "unreadable", message: "m" } as BusinessState]) {
      assert.deepEqual(businessTransition(state, drop), checking);
    }
    const proving = withFunding({ status: "proving" });
    assert.equal(businessTransition(proving, drop), proving);
    assert.equal(businessTransition(checking, drop), checking);
  });

  test("un événement hors de son état ne change rien", () => {
    const cases: [BusinessState, BusinessEvent][] = [
      [initialBusinessState, { type: "FILE_CHECKED", file, precheck }],
      [initialBusinessState, { type: "FILE_REJECTED", message: "m" }],
      [initialBusinessState, { type: "FUNDING", event: { type: "PROVE" } }],
      [checking, { type: "FUNDING", event: { type: "PROVE" } }],
      [ready, { type: "FILE_CHECKED", file, precheck }],
      [ready, { type: "FILE_REJECTED", message: "m" }],
      [ready, { type: "FUNDING", event: { type: "CERTIFY" } }],
    ];
    for (const [state, event] of cases) assert.equal(businessTransition(state, event), state, `${state.status} + ${event.type}`);
  });

  test("occupé pendant le contrôle et le financement seulement", () => {
    assert.deepEqual(
      [initialBusinessState, checking, ready, withFunding({ status: "certifying", proof, durationMs: 1 }), withFunding({ status: "duplicate", txHash: "D" })].map(isBusy),
      [false, true, false, true, false],
    );
  });
});

describe("invoiceChecks et getPaidBlocker", () => {
  test("chaque contrôle du navigateur, puis le KYB, avec ✓ et un détail", () => {
    const rows = invoiceChecks(precheck);
    assert.deepEqual(
      rows.map((row) => row.id),
      ["signature", "debtor", "network", "amount", "dueDate", "unique", "kyb"],
    );
    assert.ok(rows.every((row) => row.ok && row.label !== "" && row.detail !== ""));
    assert.equal(getPaidBlocker(precheck), undefined);
  });

  test("un contrôle en échec garde son libellé et dit pourquoi", () => {
    const failed = invoiceChecks(alreadyFinanced).filter((row) => !row.ok);
    assert.deepEqual(failed.map((row) => row.id), ["unique"]);
    assert.match(failed[0].detail, /already financed/i);
    assert.match(getPaidBlocker(alreadyFinanced) ?? "", /already financed/i);
  });

  test("sans KYB, le bouton est bloqué avec la raison", () => {
    const noKyb = { ...precheck, kyb: { account: ACCOUNT, done: false } };
    assert.equal(invoiceChecks(noKyb).find((row) => row.id === "kyb")?.ok, false);
    assert.match(getPaidBlocker(noKyb) ?? "", /KYB_PME/);
  });
});

describe("fundingSteps", () => {
  const states = (funding: FundingState) => fundingSteps(funding, "managed").map((step) => step.state);

  test("compte géré, quatre étapes : preuve, certificat, contrôles de Bari, prêt", () => {
    assert.deepEqual(
      fundingSteps({ status: "proving" }, "managed").map((step) => step.id),
      ["proof", "certificate", "checks", "loan"],
    );
    assert.deepEqual(states({ status: "proving" }), ["current", "pending", "pending", "pending"]);
  });

  test("chaque étape terminée montre sa durée ou sa transaction", () => {
    assert.deepEqual(states({ status: "certifying", proof, durationMs: 1_234 }), ["done", "current", "pending", "pending"]);
    const underwriting = fundingSteps({ status: "underwriting", durationMs: 1_234, certificate }, "managed");
    assert.deepEqual(underwriting.map((step) => step.state), ["done", "done", "current", "pending"]);
    assert.equal(underwriting[0].detail, "in 1.2 s");
    assert.equal(underwriting[1].hash, "C3RT");
  });

  test("financé : les contrôles de Bari et le LoanSet", () => {
    const steps = fundingSteps({ status: "funded", durationMs: 900, certificate, loan }, "managed");
    assert.deepEqual(steps.map((step) => step.state), ["done", "done", "done", "done"]);
    assert.deepEqual(steps[2].checks, loan.checks);
    assert.equal(steps[3].hash, "L0AN");
  });

  test("refusé : l'étape des contrôles échoue avec chacun d'eux", () => {
    const steps = fundingSteps({ status: "refused", durationMs: 900, certificate, reason: "Exposure above 20 %", checks }, "managed");
    assert.deepEqual(steps.map((step) => step.state), ["done", "done", "failed", "pending"]);
    assert.deepEqual(steps[2].checks, checks);
    assert.equal(steps[2].detail, "Exposure above 20 %");
  });

  test("erreur : l'étape qui a échoué porte le message", () => {
    const retry = { status: "proved", proof, durationMs: 900 } as const;
    const steps = fundingSteps({ status: "error", message: "ledger timeout", retry, failedAt: "certifying" }, "managed");
    assert.deepEqual(steps.map((step) => step.state), ["done", "failed", "pending", "pending"]);
    assert.equal(steps[1].detail, "ledger timeout");
  });

  test("aucune étape avant « Get paid now » ni pour une facture déjà financée", () => {
    assert.deepEqual(fundingSteps({ status: "invoiceReady" }, "wallet"), []);
    assert.deepEqual(fundingSteps({ status: "duplicate", txHash: "D" }, "wallet"), []);
  });

  describe("entreprise wallet : signatures dans Otsu", () => {
    const walletStates = (funding: FundingState) => fundingSteps(funding, "wallet").map((step) => step.state);
    const tx = { TransactionType: "Batch" };

    test("six étapes : le certificat puis le prêt se signent dans Otsu", () => {
      assert.deepEqual(
        fundingSteps({ status: "proving" }, "wallet").map((step) => step.label),
        [
          "Proof computed in your browser",
          "Sign the certificate in Otsu",
          "Invoice certificate on the ledger",
          "Bari's checks",
          "Sign the loan in Otsu",
          "Loan signed, money sent",
        ],
      );
    });

    test("en attente de signature : l'étape dit d'approuver dans Otsu", () => {
      const signing = fundingSteps({ status: "signingCertificate", proof, durationMs: 900, tx }, "wallet");
      assert.deepEqual(signing.map((step) => step.state), ["done", "current", "pending", "pending", "pending", "pending"]);
      assert.equal(signing[1].detail, "Approve the request in the Otsu window");
      const signingLoan = fundingSteps({ status: "signingLoan", durationMs: 900, certificate, checks, tx }, "wallet");
      assert.deepEqual(signingLoan.map((step) => step.state), ["done", "done", "done", "done", "current", "pending"]);
      assert.equal(signingLoan[2].hash, "C3RT");
      assert.deepEqual(signingLoan[3].checks, checks);
      assert.equal(signingLoan[4].detail, "Approve the request in the Otsu window");
    });

    test("blob signé envoyé : le certificat puis le prêt sont en cours sur le ledger", () => {
      assert.deepEqual(walletStates({ status: "submittingCertificate", proof, durationMs: 900, txBlob: "B" }), [
        "done",
        "done",
        "current",
        "pending",
        "pending",
        "pending",
      ]);
      assert.deepEqual(walletStates({ status: "submittingLoan", durationMs: 900, certificate, checks, txBlob: "L" }), [
        "done",
        "done",
        "done",
        "done",
        "done",
        "current",
      ]);
    });

    test("financé : chaque transaction a son lien", () => {
      const steps = fundingSteps({ status: "funded", durationMs: 900, certificate, loan }, "wallet");
      assert.ok(steps.every((step) => step.state === "done"));
      assert.deepEqual(steps.flatMap((step) => (step.hash === undefined ? [] : [step.hash])), ["C3RT", "L0AN"]);
    });

    test("refus dans Otsu : l'étape de signature échoue avec le message", () => {
      const declined = "The request was declined in Otsu. Click Try again, then approve it in the Otsu window.";
      const steps = fundingSteps(
        { status: "error", message: declined, retry: { status: "certified", durationMs: 900, certificate }, failedAt: "signingLoan" },
        "wallet",
      );
      assert.deepEqual(steps.map((step) => step.state), ["done", "done", "done", "done", "failed", "pending"]);
      assert.equal(steps[4].detail, declined);
    });
  });

  test("formatDuration", () => {
    assert.equal(formatDuration(1_234), "1.2 s");
    assert.equal(formatDuration(80), "0.1 s");
  });
});

describe("invoiceRows", () => {
  const invoices: BusinessInvoice[] = [
    { tokenId: "T1", nullifier: "N1", status: "certified", issuedAt: "2026-11-20T10:00:00.000Z", certificateTxHash: "C1" },
    {
      tokenId: "T2",
      nullifier: "N2",
      status: "active",
      issuedAt: "2026-11-21T10:00:00.000Z",
      certificateTxHash: "C2",
      loanId: "L2",
      loanTxHash: "S2",
      principal: "9000000000",
      originationFee: "45000000",
      dueDate: "2027-02-18T00:00:00.000Z",
    },
  ];

  test("plus récentes d'abord, montants du prêt en RLUSD et net reçu", () => {
    const rows = invoiceRows(invoices);
    assert.deepEqual(
      rows.map((row) => [row.id, row.status, row.advanceRlusd, row.feeRlusd, row.netRlusd]),
      [
        ["T2", "Financed", 9_000, 45, 8_955],
        ["T1", "Certified, not financed", undefined, undefined, undefined],
      ],
    );
    assert.deepEqual([rows[0].certificateTxHash, rows[0].loanTxHash, rows[0].dueDate], ["C2", "S2", "2027-02-18T00:00:00.000Z"]);
  });

  test("statuts remboursé et en défaut", () => {
    const rows = invoiceRows([
      { ...invoices[1], status: "repaid" },
      { ...invoices[1], tokenId: "T3", status: "defaulted" },
    ]);
    assert.deepEqual(rows.map((row) => row.status), ["Repaid", "Defaulted"]);
  });
});
