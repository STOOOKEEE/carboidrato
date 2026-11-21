// Pré-contrôle dans le navigateur : chaque contrôle, le verdict et l'offre, avec des sources publiques simulées.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import type { AttestedInvoiceFile, LoanOffer, OfferSchedule, PrecheckResponse, PublicDebtor } from "../../../../src/api/contract";
import { parseAttestedFile, runPrecheck, type PrecheckSources } from "./precheck";

interface PrecheckFixture {
  debtors: PublicDebtor[];
  file: AttestedInvoiceFile;
  nullifier: string;
}

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/witness.json", import.meta.url), "utf8"),
) as PrecheckFixture;

const BEFORE_DUE_DATE = new Date("2026-11-21T10:00:00Z");
const AFTER_DUE_DATE = new Date("2027-03-01T00:00:00Z");
const REGISTRATION_TX = "AB".repeat(32);
const TIERS_USD = [5_000, 10_000, 20_000, 50_000, 100_000];

const OFFER: LoanOffer = {
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
};

/** Offre d'un palier comme la calcule l'API : avance de 90 % du palier, frais de 0,5 % de l'avance. */
function tierOffer(tierUsd: number): LoanOffer {
  const principalUsd = (tierUsd * 90) / 100;
  const feeUsd = (principalUsd * 5) / 1_000;
  return { ...OFFER, provenThresholdUsd: tierUsd, principalUsd, feeUsd, netAdvanceUsd: principalUsd - feeUsd };
}

/** Barème servi par l'API, une offre par palier : le navigateur y lit celle du palier qu'il prouvera. */
const SCHEDULE: OfferSchedule = {
  advanceRatePercent: 90,
  feeRatePercent: 0.5,
  interestRatePercent: 6,
  termDays: 90,
  loanDueDate: "2027-02-18T00:00:00.000Z",
  tiers: TIERS_USD.map(tierOffer),
};

const PARAMS = {
  networkId: fixture.file.attestation.networkId,
  registry: fixture.file.attestation.registry,
  thresholdsCents: TIERS_USD.map((usd) => String(usd * 100)),
};

function sources(overrides: Partial<PrecheckSources> = {}): PrecheckSources & { offerCalls: string[] } {
  const offerCalls: string[] = [];
  return {
    offerCalls,
    debtors: async () => fixture.debtors,
    params: async () => PARAMS,
    registration: async () => ({ registered: false }),
    kybDone: async () => true,
    offer: async (dueDate) => {
      offerCalls.push(dueDate);
      return SCHEDULE;
    },
    signatureIsValid: async () => true,
    now: () => BEFORE_DUE_DATE,
    ...overrides,
  };
}

/** La facture du fixture avec un autre montant : la signature est simulée, seul le montant compte ici. */
function withAmount(amountCents: string): AttestedInvoiceFile {
  return { ...fixture.file, attestation: { ...fixture.file.attestation, amountCents } };
}

function failedChecks(result: PrecheckResponse): string[] {
  return result.checks.filter((check) => !check.ok).map((check) => check.id);
}

describe("pré-contrôle dans le navigateur", () => {
  test("une facture attestée de 10 340 $ est éligible, avec l'offre du palier de 10 000 $ et le N public", async () => {
    const deps = sources();
    const result = await runPrecheck(fixture.file, deps);
    assert.equal(fixture.file.attestation.amountCents, "1034000");
    assert.equal(result.verdict, "eligible");
    assert.deepEqual(failedChecks(result), []);
    assert.equal(result.nullifier, fixture.nullifier);
    assert.deepEqual(result.offer, OFFER);
    assert.deepEqual(deps.offerCalls, [result.invoice.dueDate]);
    assert.equal(result.invoice.amountUsd, 10_340);
    assert.deepEqual(result.kyb, { account: fixture.file.attestation.account, done: true });
  });

  test("une facture de 250 000 $ reçoit l'offre du plus haut palier, 100 000 $", async () => {
    const result = await runPrecheck(withAmount("25000000"), sources());
    assert.equal(result.verdict, "eligible");
    assert.deepEqual(result.offer, { ...OFFER, provenThresholdUsd: 100_000, principalUsd: 90_000, feeUsd: 450, netAdvanceUsd: 89_550 });
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
    const otherNetwork = sources({ params: async () => ({ ...PARAMS, networkId: 2 }) });
    assert.deepEqual(failedChecks(await runPrecheck(fixture.file, otherNetwork)), ["network"]);
    const otherRegistry = sources({ params: async () => ({ ...PARAMS, registry: fixture.file.attestation.account }) });
    assert.deepEqual(failedChecks(await runPrecheck(fixture.file, otherRegistry)), ["network"]);
  });

  test("une facture de 4 999 $, sous le premier palier, est refusée au contrôle du montant, sans offre", async () => {
    const deps = sources();
    const result = await runPrecheck(withAmount("499900"), deps);
    assert.equal(result.verdict, "rejected");
    assert.deepEqual(failedChecks(result), ["amount"]);
    assert.equal(result.offer, undefined);
    assert.deepEqual(deps.offerCalls, []);
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
