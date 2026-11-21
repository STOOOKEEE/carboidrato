// Tests de la page Transparency : liaison des preuves aux prêts, vérification injectée, agrégats et libellés.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { PROOF_PUBLIC_SIGNALS, type AuditLoan, type CertificateRequest, type FundAudit } from "../../../../src/api/contract";
import {
  exposures,
  fingerprintTally,
  fundChecks,
  initialVerification,
  keyFigures,
  loanRows,
  maxExposurePercent,
  proofTally,
  runSummary,
  verificationTransition,
  verifyLoans,
  type LoanVerdict,
  type Verification,
} from "./transparency";

const hex64 = (byte: string) => byte.repeat(32);
const N1 = hex64("A1");
const N2 = hex64("A2");
const N3 = hex64("A3");
const P1 = hex64("B1");
const P2 = hex64("B2");
const ROOT = hex64("0F");
const VINTAGE = 2026;
const EUR = 1_000_000n;

/** Signaux publics dans l'ordre du circuit, liés à N, P, la racine et le millésime donnés. */
function certificateFor(nullifier: string, pseudonym: string, root = ROOT): CertificateRequest {
  const values: Record<(typeof PROOF_PUBLIC_SIGNALS)[number], string> = {
    commitment: "1",
    nullifier: BigInt(`0x${nullifier}`).toString(),
    pseudonym: BigInt(`0x${pseudonym}`).toString(),
    debtorsRoot: BigInt(`0x${root}`).toString(),
    account: "2",
    threshold: "1000000",
    dueDate: "1802908800",
    networkId: "1000",
    registry: "3",
    vintage: String(VINTAGE),
  };
  return {
    proof: { pi_a: ["1", "2", "1"], pi_b: [["1", "2"], ["3", "4"], ["1", "0"]], pi_c: ["5", "6", "1"], protocol: "groth16", curve: "bn128" },
    publicSignals: PROOF_PUBLIC_SIGNALS.map((name) => values[name]),
  };
}

function loan(sequence: number, nullifier: string, pseudonym: string, overrides: Partial<AuditLoan> = {}): AuditLoan {
  return {
    loanId: hex64(`C${sequence}`),
    loanSequence: sequence,
    loanSetHash: hex64(`D${sequence}`),
    borrower: "rBusiness",
    principal: (9_000n * EUR).toString(),
    outstanding: (9_000n * EUR).toString(),
    status: "active",
    dueDate: "2027-02-18T12:00:00.000Z",
    reference: { nullifier, pseudonym, invoiceTokenId: "0A".repeat(24) },
    certificate: certificateFor(nullifier, pseudonym),
    anomalies: 0,
    ...overrides,
  };
}

/** 100 500 RLUSD d'actif ; P1 : un prêt en cours (9 000 RLUSD) et un remboursé ; P2 : 4 500 RLUSD en cours. */
function auditOf(loans: AuditLoan[], fundAssets = 100_500n * EUR): FundAudit {
  return {
    vaultId: hex64("E1"),
    brokerId: hex64("E2"),
    owner: "rBari",
    manifest: { debtorsRoot: ROOT, vintage: VINTAGE, registry: "rRegistry" },
    loans: loans.length,
    verifiedProofs: loans.length,
    anomalies: 0,
    fundAssets: fundAssets.toString(),
    sharePrice: "1005000",
    concentrationLimitPercent: 20,
    loanAudits: loans,
  };
}

const audit = auditOf([
  loan(1, N1, P1),
  loan(2, N2, P1, { status: "repaid", outstanding: "0", dueDate: undefined }),
  loan(3, N3, P2, { principal: (4_500n * EUR).toString(), outstanding: (4_500n * EUR).toString() }),
]);

const fund = { vault: { assetsTotal: (100_500n * EUR).toString(), assetsAvailable: (87_000n * EUR).toString() } };

describe("vérification des preuves dans le navigateur", () => {
  test("chaque preuve liée à son prêt et à la fiche du fonds passe au vérificateur", async () => {
    const seen: string[] = [];
    const verdicts = await verifyLoans(audit, async (certificate) => {
      seen.push(certificate.publicSignals[1]);
      return true;
    });
    assert.deepEqual(verdicts, ["verified", "verified", "verified"]);
    assert.equal(seen.length, 3);
  });

  test("preuve refusée, signaux d'un autre prêt ou d'un autre fonds, preuve absente", async () => {
    const forged = loan(4, N1, P1);
    const verdicts = await verifyLoans(
      auditOf([
        forged,
        loan(5, N2, P1, { certificate: certificateFor(N3, P1) }),
        loan(6, N3, P2, { certificate: certificateFor(N3, P2, hex64("01")) }),
        loan(7, N1, P2, { certificate: undefined }),
        loan(8, N1, P2, { reference: undefined }),
        loan(9, N1, P2, { certificate: { ...certificateFor(N1, P2), publicSignals: ["1"] } }),
      ]),
      async (certificate) => certificate !== forged.certificate,
    );
    assert.deepEqual(verdicts, ["invalid", "mismatch", "mismatch", "missing", "missing", "mismatch"]);
  });

  test("un vérificateur en échec rend la preuve invalide, pas la page", async () => {
    const verdicts = await verifyLoans(auditOf([loan(1, N1, P1)]), async () => {
      throw new Error("bad point");
    });
    assert.deepEqual(verdicts, ["invalid"]);
  });

  test("compte k/k et résumé de la vérification", () => {
    const verdicts: LoanVerdict[] = ["verified", "invalid", "verified"];
    assert.deepEqual(proofTally(verdicts), { verified: 2, total: 3 });
    const done: Verification = { status: "done", round: 1, verdicts, durationMs: 420 };
    assert.equal(runSummary(done), "2/3 proofs verified in your browser, in 0.4 s.");
    assert.equal(runSummary({ status: "verifying", round: 2 }), "Verifying every proof in your browser…");
    assert.equal(runSummary({ status: "failed", round: 1, message: "Network down" }), "Network down");
  });
});

describe("relance de la vérification", () => {
  test("chaque relance ouvre un nouveau tour, terminé ou en échec", () => {
    let run = verificationTransition(initialVerification, { type: "START" });
    assert.deepEqual(run, { status: "verifying", round: 1 });
    run = verificationTransition(run, { type: "DONE", verdicts: ["verified"], durationMs: 10 });
    assert.deepEqual(run, { status: "done", round: 1, verdicts: ["verified"], durationMs: 10 });
    run = verificationTransition(run, { type: "START" });
    assert.deepEqual(run, { status: "verifying", round: 2 });
    run = verificationTransition(run, { type: "FAILED", message: "Could not load the verification key." });
    assert.deepEqual(run, { status: "failed", round: 2, message: "Could not load the verification key." });
  });

  test("un résultat hors tour (déjà relancé) est ignoré", () => {
    const run: Verification = { status: "verifying", round: 2 };
    assert.equal(verificationTransition({ status: "idle", round: 0 }, { type: "DONE", verdicts: [], durationMs: 1 }).status, "idle");
    assert.equal(verificationTransition(run, { type: "START" }), run);
  });
});

describe("agrégats du fonds", () => {
  test("empreintes uniques, puis doublons signalés", () => {
    assert.deepEqual(fingerprintTally(audit.loanAudits), { distinct: 3, total: 3, duplicates: [] });
    const twice = [loan(1, N1, P1), loan(2, N1, P2), loan(3, N2, P2, { reference: undefined })];
    assert.deepEqual(fingerprintTally(twice), { distinct: 1, total: 2, duplicates: [N1] });
  });

  test("exposition par pseudonyme : part de l'actif, barre jusqu'au plafond, tri décroissant", () => {
    const rows = exposures(audit);
    assert.deepEqual(
      rows.map(({ pseudonym, loans, outstanding, fundPercent, barPercent, breach }) => ({
        pseudonym,
        loans,
        outstanding,
        fundPercent,
        barPercent,
        breach,
      })),
      [
        { pseudonym: P1, loans: 2, outstanding: 9_000n * EUR, fundPercent: 8.95, barPercent: 44.77, breach: false },
        { pseudonym: P2, loans: 1, outstanding: 4_500n * EUR, fundPercent: 4.47, barPercent: 22.38, breach: false },
      ],
    );
    assert.equal(rows[0].alias, "B1B1…B1B1");
    assert.equal(maxExposurePercent(rows), 8.95);
  });

  test("dépassement du plafond : barre pleine et signalée ; fonds vide sans division par zéro", () => {
    const [over] = exposures(auditOf([loan(1, N1, P1)], 40_000n * EUR));
    assert.equal(over.fundPercent, 22.5);
    assert.equal(over.barPercent, 100);
    assert.equal(over.breach, true);
    const [empty] = exposures(auditOf([loan(1, N1, P1)], 0n));
    assert.equal(empty.fundPercent, 0);
    assert.equal(maxExposurePercent([]), 0);
  });

  test("contrôles en clair : une facture financée une fois, aucun débiteur au-dessus du plafond", () => {
    assert.deepEqual(fundChecks(audit), [
      { id: "unique", label: "Each invoice financed once", ok: true, detail: "3 unique fingerprints for 3 loans" },
      { id: "concentration", label: "No debtor above 20% of the fund", ok: true, detail: "Largest exposure: 8.95% of the fund" },
    ]);
    const bad = fundChecks(auditOf([loan(1, N1, P1), loan(2, N1, P1)], 40_000n * EUR));
    assert.deepEqual(
      bad.map(({ ok, detail }) => ({ ok, detail })),
      [
        { ok: false, detail: "1 fingerprint used by more than one loan" },
        { ok: false, detail: "1 debtor above the limit (largest: 45% of the fund)" },
      ],
    );
  });

  test("chiffres clés : preuves k/k, débiteurs distincts, exposition max, prix de la part, prêté", () => {
    const done: Verification = { status: "done", round: 1, verdicts: ["verified", "verified", "invalid"], durationMs: 5 };
    assert.deepEqual(
      keyFigures(audit, fund, done).map(({ id, value }) => [id, value]),
      [
        ["proofs", "2/3"],
        ["debtors", "2"],
        ["exposure", "8.95%"],
        ["price", "1.0050 RLUSD"],
        ["lent", "13.43%"],
      ],
    );
    const pending = keyFigures(audit, undefined, { status: "verifying", round: 1 });
    assert.equal(pending.find((figure) => figure.id === "proofs")?.value, "…");
    assert.equal(pending.find((figure) => figure.id === "lent")?.value, "—");
  });
});

describe("tableau des prêts", () => {
  test("statut, montant, échéance, débiteur, empreinte et verdict de chaque prêt", () => {
    const rows = loanRows(audit, { status: "done", round: 1, verdicts: ["verified", "invalid", "mismatch"], durationMs: 5 });
    assert.deepEqual(
      rows.map(({ sequence, status, principal, due, debtor, fingerprint, proof, proofState, hash }) => ({
        sequence,
        status,
        principal,
        due,
        debtor,
        fingerprint,
        proof,
        proofState,
        hash,
      })),
      [
        { sequence: 1, status: "Active", principal: "9,000.00 RLUSD", due: "18 Feb 2027", debtor: "B1B1…B1B1", fingerprint: "A1A1…A1A1", proof: "Verified", proofState: "ok", hash: hex64("D1") },
        { sequence: 2, status: "Repaid", principal: "9,000.00 RLUSD", due: "—", debtor: "B1B1…B1B1", fingerprint: "A2A2…A2A2", proof: "Invalid proof", proofState: "bad", hash: hex64("D2") },
        { sequence: 3, status: "Active", principal: "4,500.00 RLUSD", due: "18 Feb 2027", debtor: "B2B2…B2B2", fingerprint: "A3A3…A3A3", proof: "Does not match this loan", proofState: "bad", hash: hex64("D3") },
      ],
    );
    const defaulted = auditOf([loan(1, N1, P1, { reference: undefined, status: "defaulted" })]);
    const proofOf = (run: Verification) =>
      loanRows(defaulted, run).map(({ status, debtor, proof, proofState }) => ({ status, debtor, proof, proofState }));
    assert.deepEqual(proofOf({ status: "verifying", round: 1 }), [{ status: "Defaulted", debtor: "—", proof: "Checking…", proofState: "pending" }]);
    assert.deepEqual(proofOf({ status: "failed", round: 1, message: "down" }), [
      { status: "Defaulted", debtor: "—", proof: "Not checked", proofState: "bad" },
    ]);
  });
});
