// Pré-contrôle dans le navigateur : chaque contrôle, le verdict et l'offre, avec des sources publiques simulées.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import type { AttestedInvoiceFile, LoanOffer, PrecheckResponse, PublicDebtor } from "../../../../src/api/contract";
import { parseAttestedFile, runPrecheck, type PrecheckSources } from "./precheck";

interface PrecheckFixture {
  debtors: PublicDebtor[];
  file: AttestedInvoiceFile;
  threshold: string;
  nullifier: string;
}

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/witness.json", import.meta.url), "utf8"),
) as PrecheckFixture;

const BEFORE_DUE_DATE = new Date("2026-11-21T10:00:00Z");
const AFTER_DUE_DATE = new Date("2027-03-01T00:00:00Z");
const REGISTRATION_TX = "AB".repeat(32);

const OFFER: LoanOffer = {
  provenThresholdEur: 10_000,
  advanceRatePercent: 90,
  principalEur: 9_000,
  feeEur: 45,
  netAdvanceEur: 8_955,
  interestEur: 133.16,
  interestRatePercent: 6,
  totalCostEur: 178.16,
  annualCostPercent: 8.1,
  termDays: 90,
  repaymentEur: 9_133.16,
};

function sources(overrides: Partial<PrecheckSources> = {}): PrecheckSources & { offerCalls: string[] } {
  const offerCalls: string[] = [];
  return {
    offerCalls,
    debtors: async () => fixture.debtors,
    params: async () => ({
      networkId: fixture.file.attestation.networkId,
      registry: fixture.file.attestation.registry,
      thresholdCents: fixture.threshold,
    }),
    registration: async () => ({ registered: false }),
    kybDone: async () => true,
    offer: async (dueDate) => {
      offerCalls.push(dueDate);
      return OFFER;
    },
    signatureIsValid: async () => true,
    now: () => BEFORE_DUE_DATE,
    ...overrides,
  };
}

function failedChecks(result: PrecheckResponse): string[] {
  return result.checks.filter((check) => !check.ok).map((check) => check.id);
}

describe("pré-contrôle dans le navigateur", () => {
  test("une facture attestée valide est éligible, avec l'offre et le N public", async () => {
    const deps = sources();
    const result = await runPrecheck(fixture.file, deps);
    assert.equal(result.verdict, "eligible");
    assert.deepEqual(failedChecks(result), []);
    assert.equal(result.nullifier, fixture.nullifier);
    assert.deepEqual(result.offer, OFFER);
    assert.deepEqual(deps.offerCalls, [result.invoice.dueDate]);
    assert.equal(result.invoice.amountEur, Number(fixture.file.attestation.amountCents) / 100);
    assert.deepEqual(result.kyb, { account: fixture.file.attestation.account, done: true });
  });

  test("une signature invalide refuse la facture sans offre", async () => {
    const deps = sources({ signatureIsValid: async () => false });
    const result = await runPrecheck(fixture.file, deps);
    assert.equal(result.verdict, "rejected");
    assert.deepEqual(failedChecks(result), ["signature"]);
    assert.equal(result.offer, undefined);
    assert.deepEqual(deps.offerCalls, []);
  });

  test("un débiteur absent de la liste publique est refusé", async () => {
    const result = await runPrecheck(fixture.file, sources({ debtors: async () => fixture.debtors.slice(1) }));
    assert.deepEqual(failedChecks(result), ["debtor"]);
  });

  test("une attestation pour un autre réseau ou un autre registre est refusée", async () => {
    const otherNetwork = sources({
      params: async () => ({ networkId: 2, registry: fixture.file.attestation.registry, thresholdCents: fixture.threshold }),
    });
    assert.deepEqual(failedChecks(await runPrecheck(fixture.file, otherNetwork)), ["network"]);
    const otherRegistry = sources({
      params: async () => ({
        networkId: fixture.file.attestation.networkId,
        registry: fixture.file.attestation.account,
        thresholdCents: fixture.threshold,
      }),
    });
    assert.deepEqual(failedChecks(await runPrecheck(fixture.file, otherRegistry)), ["network"]);
  });

  test("une facture sous le seuil prouvé est refusée", async () => {
    const tooHigh = (BigInt(fixture.file.attestation.amountCents) + 1n).toString();
    const result = await runPrecheck(
      fixture.file,
      sources({
        params: async () => ({
          networkId: fixture.file.attestation.networkId,
          registry: fixture.file.attestation.registry,
          thresholdCents: tooHigh,
        }),
      }),
    );
    assert.deepEqual(failedChecks(result), ["amount"]);
  });

  test("une facture échue est refusée", async () => {
    const result = await runPrecheck(fixture.file, sources({ now: () => AFTER_DUE_DATE }));
    assert.deepEqual(failedChecks(result), ["dueDate"]);
  });

  test("un N déjà enregistré est refusé avec la transaction qui l'a enregistré", async () => {
    const seen: [string, string][] = [];
    const result = await runPrecheck(
      fixture.file,
      sources({
        registration: async (nullifier, account) => {
          seen.push([nullifier, account]);
          return { registered: true, txHash: REGISTRATION_TX };
        },
      }),
    );
    assert.deepEqual(seen, [[fixture.nullifier, fixture.file.attestation.account]]);
    assert.deepEqual(failedChecks(result), ["unique"]);
    assert.equal(result.registeredBy, REGISTRATION_TX);
  });
});

describe("lecture d'un fichier de facture attestée", () => {
  test("accepte le format bari.attested-invoice.v1", () => {
    assert.deepEqual(parseAttestedFile(JSON.parse(JSON.stringify(fixture.file))), fixture.file);
  });

  test("refuse un autre format ou une attestation incomplète", () => {
    assert.equal(parseAttestedFile({ ...fixture.file, format: "other" }), undefined);
    const { signature: _signature, ...unsigned } = fixture.file.attestation;
    assert.equal(parseAttestedFile({ ...fixture.file, attestation: unsigned }), undefined);
    assert.equal(parseAttestedFile("not json"), undefined);
  });
});
