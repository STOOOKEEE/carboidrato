// Espace entreprise : routes réservées au rôle business, certificat et prêt pour le compte géré de la session,
// refus du prêt contrôle par contrôle, factures du compte, barème public des paliers.

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { Client, isoTimeToRippleTime, Wallet, type LedgerEntry } from "xrpl";
import { ACTOR_NAMES, type Actors } from "../../../accounts/actors.js";
import type { Fund } from "../../../fund/fund.js";
import { produceInvoiceCertificate, verifiedDebtorsRoot, type InvoiceCertificate } from "../../../invoice/certificate.js";
import { decodeCertificateMetadata } from "../../../invoice/certificateMetadata.js";
import { DEMO_DEBTOR } from "../../../invoice/debtors.js";
import { INVOICE_TOKEN_SUPPLY } from "../../../invoice/invoiceToken.js";
import { FakeLedger } from "../../../xrpl/fakeLedger.js";
import { RLUSD_CURRENCY } from "../../../xrpl/stablecoin.js";
import { PUBLIC_SIGNAL_ORDER, releaseZkResources } from "../../../zk/index.js";
import type { BusinessInvoice, LoanRefusal, OfferSchedule } from "../../contract.js";
import { buildApp } from "../app.js";
import type { ApiContext } from "../context.js";
import { fakeApiConfig, fakeContext } from "../fakeContext.js";

const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_UNPROCESSABLE = 422;
const NETWORK_ID = 1000;
const VINTAGE = 2026;
const PASSWORD = "correct horse battery";
const INVOICE_TOKEN_ID = "00000001".padEnd(48, "A");
const LEGACY_TOKEN_ID = "00000003".padEnd(48, "C");
const OTHER_TOKEN_ID = "00000004".padEnd(48, "D");
const NOW = isoTimeToRippleTime("2026-11-21T10:00:00Z");
const REDEMPTION_DATE = isoTimeToRippleTime("2027-03-31T00:00:00Z");

const actors = Object.fromEntries(ACTOR_NAMES.map((name) => [name, Wallet.generate()])) as Actors;
const ledger = new FakeLedger(NETWORK_ID);
const managed: Wallet[] = [];
const sessions = { marco: "", other: "", lender: "" };
let app: FastifyInstance;
let context: ApiContext;
let marco: Wallet;
let other: Wallet;
let certificate: InvoiceCertificate;
let fund: Fund;

async function signup(body: object): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/auth/signup", payload: body });
  assert.equal(response.statusCode, 201, response.body);
  return String(response.headers["set-cookie"]).split(";")[0];
}

const business = (email: string, company: string, vatNumber: string) => ({
  email,
  password: PASSWORD,
  role: "business",
  profile: { company, vatNumber },
});

const inject = (method: "GET" | "POST", url: string, cookie?: string, payload?: object) =>
  app.inject({ method, url, payload, headers: cookie === undefined ? {} : { cookie } });

/** Preuve bien formée mais fictive : échéance future, seuil choisi. */
function fakeProof(thresholdCents: string) {
  const signals = PUBLIC_SIGNAL_ORDER.map((name) => {
    if (name === "dueDate") return String(Math.floor(Date.parse("2027-02-18T00:00:00Z") / 1_000));
    return name === "threshold" ? thresholdCents : "1";
  });
  return {
    proof: { pi_a: ["1", "2", "1"], pi_b: [["1", "2"], ["3", "4"], ["1", "0"]], pi_c: ["5", "6", "1"], protocol: "groth16", curve: "bn128" },
    publicSignals: signals,
  };
}

/** Certificat de Marco enregistré, MPT facture remis à Bari ; pas de KYB sur son compte. */
function putMarcoInvoiceOnLedger(): void {
  ledger.setCloseTime(NOW);
  ledger.putCredential({
    LedgerEntryType: "Credential",
    Subject: actors.bari_registry.address,
    Issuer: marco.address,
    CredentialType: certificate.nullifier,
    Flags: 0,
  } as LedgerEntry.Credential);
  ledger.putMptIssuance(INVOICE_TOKEN_ID, {
    LedgerEntryType: "MPTokenIssuance",
    Issuer: marco.address,
    MPTokenMetadata: certificate.metadataHex,
  } as LedgerEntry.MPTokenIssuance);
  ledger.putMptBalance(INVOICE_TOKEN_ID, actors.bari.address, INVOICE_TOKEN_SUPPLY);
  ledger.putVault({ index: fund.cohort.vaultId, AssetsTotal: "100000" } as LedgerEntry.Vault);
}

before(async () => {
  const client = new Client("wss://alphanet.example");
  client.networkID = NETWORK_ID;
  context = fakeContext({
    actors,
    ledger,
    client,
    provisionAccount: async ({ role }) => {
      const wallet = Wallet.generate();
      managed.push(wallet);
      return role === "public_body" ? undefined : { address: wallet.address, seed: wallet.seed ?? "" };
    },
  });
  app = await buildApp(fakeApiConfig, context);
  await app.ready();
  sessions.marco = await signup(business("marco@costruzioni.it", "Marco Costruzioni S.r.l.", "IT01234567890"));
  marco = managed[0];
  sessions.other = await signup(business("anna@edilizia.it", "Edilizia Anna S.r.l.", "IT09876543210"));
  other = managed[1];
  sessions.lender = await signup({
    email: "alice@example.com",
    password: PASSWORD,
    role: "lender",
    profile: { name: "Alice Rossi", country: "IT", riskAcknowledged: true },
  });

  fund = {
    stablecoin: { currency: RLUSD_CURRENCY, issuer: actors.stable_issuer.address },
    domainId: "D".repeat(64),
    cohort: { vaultId: "1".repeat(64), shareMptId: "00000005".padEnd(48, "F"), subscriptionDate: 0, redemptionDate: REDEMPTION_DATE },
    brokerId: "A".repeat(64),
    manifest: { debtorsRoot: await verifiedDebtorsRoot(), vintage: VINTAGE, registry: actors.bari_registry.address },
  };
  context.store.reset(fund);
  certificate = await produceInvoiceCertificate({
    invoice: {
      debtor: DEMO_DEBTOR,
      number: "IT-PA-2026-000901",
      issueDate: new Date("2026-11-01T00:00:00Z"),
      dueDate: new Date("2027-02-18T00:00:00Z"),
      amountEur: 10_340,
    },
    smeAccount: marco.address,
    registry: actors.bari_registry.address,
    networkId: NETWORK_ID,
    vintage: VINTAGE,
    thresholdCents: 1_000_000n,
  });
  putMarcoInvoiceOnLedger();
  context.store.update((state) => {
    state.invoices.push(
      { tokenId: INVOICE_TOKEN_ID, certificate, issuedAt: "2026-11-21T10:00:00.000Z", owner: marco.address, txHash: "B".repeat(64) },
      { tokenId: OTHER_TOKEN_ID, certificate, issuedAt: "2026-11-21T11:00:00.000Z", owner: other.address, txHash: "C".repeat(64) },
      { tokenId: LEGACY_TOKEN_ID, certificate, issuedAt: "2026-11-20T10:00:00.000Z" },
    );
    state.loans.push(
      {
        loanId: "E".repeat(64),
        reference: { nullifier: certificate.nullifier, invoiceTokenId: OTHER_TOKEN_ID, pseudonym: certificate.pseudonym },
        status: "active",
        createdAt: "2026-11-21T11:05:00.000Z",
        borrower: other.address,
        txHash: "F".repeat(64),
        principal: "9000000000",
        originationFee: "45000000",
        dueDate: "2027-02-18T00:00:00Z",
      },
      {
        loanId: "9".repeat(64),
        reference: { nullifier: certificate.nullifier, invoiceTokenId: LEGACY_TOKEN_ID, pseudonym: certificate.pseudonym },
        status: "repaid",
        createdAt: "2026-11-20T10:05:00.000Z",
      },
    );
  });
});

after(async () => {
  await app.close();
  await releaseZkResources();
});

describe("routes de l'espace entreprise", () => {
  const routes: ["GET" | "POST", string, object?][] = [
    ["POST", "/api/sme/certificate", fakeProof("1000000")],
    ["POST", "/api/sme/loan", { tokenId: INVOICE_TOKEN_ID }],
    ["GET", "/api/business/invoices"],
  ];
  for (const [method, url, payload] of routes) {
    test(`${method} ${url} : 401 sans session, 403 pour un prêteur`, async () => {
      assert.equal((await inject(method, url, undefined, payload)).statusCode, HTTP_UNAUTHORIZED);
      assert.equal((await inject(method, url, sessions.lender, payload)).statusCode, HTTP_FORBIDDEN);
    });
  }
});

describe("POST /api/sme/certificate", () => {
  test("un seuil prouvé hors des paliers publics est refusé", async () => {
    const response = await inject("POST", "/api/sme/certificate", sessions.marco, fakeProof("1034000"));
    assert.equal(response.statusCode, HTTP_UNPROCESSABLE);
    assert.match(response.json<{ error: string }>().error, /public tiers/);
  });

  test("la preuve lie le compte de la session : celle de Marco est refusée pour une autre entreprise", async () => {
    const { proof } = decodeCertificateMetadata(certificate.metadataHex);
    const response = await inject("POST", "/api/sme/certificate", sessions.other, proof);
    assert.equal(response.statusCode, HTTP_UNPROCESSABLE);
    assert.match(response.json<{ error: string }>().error, /Proof rejected/);
  });
});

describe("POST /api/sme/loan", () => {
  test("refus en 422 avec chaque contrôle ; le premier en échec explique pourquoi", async () => {
    const response = await inject("POST", "/api/sme/loan", sessions.marco, { tokenId: INVOICE_TOKEN_ID });
    assert.equal(response.statusCode, HTTP_UNPROCESSABLE, response.body);
    const refusal = response.json<LoanRefusal>();
    assert.deepEqual(
      refusal.checks.map(({ id, ok }) => ({ id, ok })),
      [
        { id: "kyb", ok: false },
        { id: "proof", ok: true },
        { id: "advance", ok: true },
        { id: "unique", ok: true },
        { id: "concentration", ok: true },
        { id: "maturity", ok: true },
      ],
    );
    assert.match(refusal.checks[0].reason ?? "", /KYB_PME/);
    assert.match(refusal.error, /KYB_PME/);
    assert.deepEqual(refusal.transactions, []);
  });

  test("la facture d'une autre entreprise est introuvable pour ce compte", async () => {
    const response = await inject("POST", "/api/sme/loan", sessions.marco, { tokenId: OTHER_TOKEN_ID });
    assert.equal(response.statusCode, HTTP_NOT_FOUND);
  });
});

describe("GET /api/business/invoices", () => {
  test("seules les factures du compte de la session, avec leur prêt une fois financées", async () => {
    const own = await inject("GET", "/api/business/invoices", sessions.other);
    assert.equal(own.statusCode, HTTP_OK);
    assert.deepEqual(own.json<BusinessInvoice[]>(), [
      {
        tokenId: OTHER_TOKEN_ID,
        nullifier: certificate.nullifier,
        status: "active",
        issuedAt: "2026-11-21T11:00:00.000Z",
        certificateTxHash: "C".repeat(64),
        loanId: "E".repeat(64),
        loanTxHash: "F".repeat(64),
        principal: "9000000000",
        originationFee: "45000000",
        dueDate: "2027-02-18T00:00:00Z",
      },
    ]);

    const marcoInvoices = (await inject("GET", "/api/business/invoices", sessions.marco)).json<BusinessInvoice[]>();
    assert.deepEqual(
      marcoInvoices.map(({ tokenId, status, certificateTxHash, loanId }) => ({ tokenId, status, certificateTxHash, loanId })),
      [{ tokenId: INVOICE_TOKEN_ID, status: "certified", certificateTxHash: "B".repeat(64), loanId: undefined }],
    );
  });
});

describe("GET /api/offer", () => {
  test("barème public par palier, échéance du prêt bornée par le rachat du fonds", async () => {
    const response = await inject("GET", "/api/offer?dueDate=2027-12-31T00:00:00Z");
    assert.equal(response.statusCode, HTTP_OK);
    const offer = response.json<OfferSchedule>();
    assert.deepEqual(
      offer.tiers.map(({ provenThresholdEur, principalEur, feeEur }) => [provenThresholdEur, principalEur, feeEur]),
      [
        [5_000, 4_500, 22.5],
        [10_000, 9_000, 45],
        [20_000, 18_000, 90],
        [50_000, 45_000, 225],
        [100_000, 90_000, 450],
      ],
    );
    assert.equal(offer.feeRatePercent, 0.5);
    assert.ok(Date.parse(offer.loanDueDate) < Date.parse("2027-03-31T00:00:00Z"));
  });

  test("échéance passée ou illisible : 400", async () => {
    assert.equal((await inject("GET", "/api/offer?dueDate=2020-01-01")).statusCode, 400);
    assert.equal((await inject("GET", "/api/offer?dueDate=soon")).statusCode, 400);
  });
});
