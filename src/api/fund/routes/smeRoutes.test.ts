// Espace entreprise : routes réservées au rôle business, certificat et prêt pour le compte géré de la session, ou
// préparés pour le wallet de l'entreprise (Otsu) puis soumis s'ils reviennent signés tels quels ; refus du prêt
// contrôle par contrôle, factures du compte, barème public des paliers.

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { FastifyInstance } from "fastify";
import {
  Client,
  decode,
  hashes,
  isoTimeToRippleTime,
  Wallet,
  type Batch,
  type LedgerEntry,
  type SubmittableTransaction,
  type Transaction,
} from "xrpl";
import { ACTOR_NAMES, type Actors } from "../../../accounts/actors.js";
import type { Fund } from "../../../fund/fund.js";
import { produceInvoiceCertificate, verifiedDebtorsRoot, type InvoiceCertificate } from "../../../invoice/certificate.js";
import { decodeCertificateMetadata } from "../../../invoice/certificateMetadata.js";
import { DEMO_DEBTOR } from "../../../invoice/debtors.js";
import { INVOICE_TOKEN_SUPPLY, invoiceTokenId } from "../../../invoice/invoiceToken.js";
import { CREDENTIAL_TYPES } from "../../../kyb/kycCredentials.js";
import { loanTerms } from "../../../lending/loanTerms.js";
import { usdToUnits } from "../../../lib/amounts.js";
import { textToHex } from "../../../lib/encoding.js";
import { FakeLedger } from "../../../xrpl/fakeLedger.js";
import type { LedgerTransaction } from "../../../xrpl/ledger.js";
import { SIGNING_WINDOW_LEDGERS, type WalletTxPorts } from "../../../xrpl/preparedTx.js";
import { RLUSD_CURRENCY } from "../../../xrpl/stablecoin.js";
import type { TxOutcome } from "../../../xrpl/submit.js";
import { PUBLIC_SIGNAL_ORDER, releaseZkResources } from "../../../zk/index.js";
import type {
  BusinessInvoice,
  CertificateResponse,
  LoanRefusal,
  LoanResponse,
  LoanSignature,
  OfferSchedule,
  PreparedSignature,
} from "../../contract.js";
import { buildApp } from "../app.js";
import { issueSession, SESSION_COOKIE } from "../auth.js";
import type { ApiContext } from "../context.js";
import { fakeApiConfig, fakeContext } from "../fakeContext.js";

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_UNPROCESSABLE = 422;
const NETWORK_ID = 1000;
const VINTAGE = 2026;
const PASSWORD = "correct horse battery";
const INVOICE_TOKEN_ID = "00000001".padEnd(48, "A");
const LEGACY_TOKEN_ID = "00000003".padEnd(48, "C");
const OTHER_TOKEN_ID = "00000004".padEnd(48, "D");
const NOW = isoTimeToRippleTime("2026-11-21T10:00:00Z");
const REDEMPTION_DATE = isoTimeToRippleTime("2027-03-31T00:00:00Z");
const WALLET_SEQUENCE = 30;
const BARI_SEQUENCE = 7;
const LEDGER_INDEX = 900;
const AUTOFILLED_FEE = "48";
const LOAN_ID = "4C".repeat(32);
const LSF_ACCEPTED = 0x00010000;
const NOT_PREPARED = "This is not the transaction Atlas prepared. Start again.";

const actors = Object.fromEntries(ACTOR_NAMES.map((name) => [name, Wallet.generate()])) as Actors;
const ledger = new FakeLedger(NETWORK_ID);
const managed: Wallet[] = [];
const sessions = { marco: "", other: "", lender: "", wanda: "" };
/** Entreprise connectée par son wallet : Bari n'en a jamais la seed. */
const wanda = Wallet.generate();
let app: FastifyInstance;
let context: ApiContext;
let marco: Wallet;
let other: Wallet;
let certificate: InvoiceCertificate;
let wandaCertificate: InvoiceCertificate;
let fund: Fund;

/** Blobs reçus par le faux nœud ; la séquence de Bari peut avancer entre la préparation et la signature. */
const submitted: string[] = [];
let bariSequence = BARI_SEQUENCE;

function outcome(hash: string, meta: object): TxOutcome {
  return { hash, result: "tesSUCCESS", meta: { TransactionResult: "tesSUCCESS", TransactionIndex: 0, AffectedNodes: [], ...meta } } as TxOutcome;
}

/** Faux nœud : applique le Batch du certificat (registre, MPT facture remis à Bari) ou le LoanSet (avance reçue). */
function applyOnLedger(txBlob: string, hash: string): TxOutcome {
  const tx = decode(txBlob) as unknown as SubmittableTransaction;
  if (tx.TransactionType === "LoanSet") {
    ledger.putStablecoinBalance(fund.stablecoin, tx.Account, loanTerms(usdToUnits(10_000)).netAdvance);
    return outcome(hash, { AffectedNodes: [{ CreatedNode: { LedgerEntryType: "Loan", LedgerIndex: LOAN_ID, NewFields: {} } }] });
  }
  assert.equal(tx.TransactionType, "Batch");
  const inner = (tx as Batch).RawTransactions.map(({ RawTransaction }) => RawTransaction);
  const [registration, issuance] = inner;
  assert.equal(registration.TransactionType, "CredentialCreate");
  assert.equal(issuance.TransactionType, "MPTokenIssuanceCreate");
  const tokenId = invoiceTokenId(tx.Account, issuance.Sequence ?? 0);
  inner.forEach((innerTx, index) => {
    const meta = { TransactionResult: "tesSUCCESS", AffectedNodes: [], ...(index === 1 ? { mpt_issuance_id: tokenId } : {}) };
    ledger.putTransaction({ hash: hashes.hashSignedTx(innerTx), validated: true, meta } as unknown as LedgerTransaction);
  });
  ledger.putCredential({
    LedgerEntryType: "Credential",
    Subject: registration.Subject,
    Issuer: tx.Account,
    CredentialType: registration.CredentialType,
    Flags: 0,
    PreviousTxnID: hash,
  } as LedgerEntry.Credential);
  ledger.putMptIssuance(tokenId, {
    LedgerEntryType: "MPTokenIssuance",
    Issuer: tx.Account,
    MPTokenMetadata: issuance.MPTokenMetadata,
  } as LedgerEntry.MPTokenIssuance);
  ledger.putMptBalance(tokenId, actors.bari.address, INVOICE_TOKEN_SUPPLY);
  return outcome(hash, {});
}

/** Faux nœud vu du wallet : séquences, autofill comme xrpl.js (frais, transactions internes), soumission. */
const walletPorts: WalletTxPorts = {
  accountState: async (account) => ({
    sequence: account === actors.bari.address ? bariSequence : WALLET_SEQUENCE,
    ledgerIndex: LEDGER_INDEX,
  }),
  autofill: async <T extends SubmittableTransaction>(tx: T) => {
    if (tx.TransactionType !== "Batch") return { ...tx, Fee: AUTOFILLED_FEE };
    const RawTransactions = (tx as unknown as Batch).RawTransactions.map(({ RawTransaction }) => ({
      RawTransaction: { ...RawTransaction, Fee: "0", SigningPubKey: "" },
    }));
    return { ...tx, Fee: AUTOFILLED_FEE, RawTransactions } as T;
  },
  submitSigned: async (txBlob, hash) => {
    submitted.push(txBlob);
    return applyOnLedger(txBlob, hash);
  },
};

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
  app = await buildApp(fakeApiConfig, context, undefined, walletPorts);
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
      amountUsd: 10_340,
    },
    smeAccount: marco.address,
    registry: actors.bari_registry.address,
    networkId: NETWORK_ID,
    vintage: VINTAGE,
    thresholdCents: 1_000_000n,
  });
  putMarcoInvoiceOnLedger();
  const wandaUser = context.users.createWalletUser({
    role: "business",
    profile: { company: "Wanda Forniture S.r.l.", vatNumber: "IT05556667778" },
    address: wanda.address,
  });
  sessions.wanda = `${SESSION_COOKIE}=${issueSession(context.users.sessionSecret, wandaUser.id)}`;
  ledger.putCredential({
    LedgerEntryType: "Credential",
    Subject: wanda.address,
    Issuer: actors.kyb_issuer.address,
    CredentialType: textToHex(CREDENTIAL_TYPES.kybSme),
    Flags: LSF_ACCEPTED,
  } as LedgerEntry.Credential);
  wandaCertificate = await produceInvoiceCertificate({
    invoice: {
      debtor: DEMO_DEBTOR,
      number: "IT-PA-2026-000902",
      issueDate: new Date("2026-11-01T00:00:00Z"),
      dueDate: new Date("2027-02-18T00:00:00Z"),
      amountUsd: 10_340,
    },
    smeAccount: wanda.address,
    registry: actors.bari_registry.address,
    networkId: NETWORK_ID,
    vintage: VINTAGE,
    thresholdCents: 1_000_000n,
  });
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
    ["POST", "/api/sme/certificate/submit", { tx_blob: "00" }],
    ["POST", "/api/sme/loan", { tokenId: INVOICE_TOKEN_ID }],
    ["POST", "/api/sme/loan/submit", { tx_blob: "00" }],
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
      offer.tiers.map(({ provenThresholdUsd, principalUsd, feeUsd }) => [provenThresholdUsd, principalUsd, feeUsd]),
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

describe("entreprise connectée par son wallet (Otsu)", () => {
  /** Ce que fait Otsu : signe la transaction reçue, sans rien y changer. */
  const signed = (wallet: Wallet, tx: Record<string, unknown>) => wallet.sign(tx as unknown as Transaction).tx_blob;
  const wandaProof = () => decodeCertificateMetadata(wandaCertificate.metadataHex).proof;
  const submitBlob = (route: "certificate" | "loan", cookie: string, txBlob: string) =>
    inject("POST", `/api/sme/${route}/submit`, cookie, { tx_blob: txBlob });

  async function preparedCertificate(): Promise<PreparedSignature> {
    const response = await inject("POST", "/api/sme/certificate", sessions.wanda, wandaProof());
    assert.equal(response.statusCode, HTTP_OK, response.body);
    return response.json<PreparedSignature>();
  }

  let tokenId = "";

  test("certificat : Batch préparé, compte externe = l'entreprise, Bari seul dans BatchSigners, rien de soumis", async () => {
    const before = submitted.length;
    const body = await preparedCertificate();
    assert.equal(body.status, "sign");
    assert.equal(body.labels.length, 4);
    assert.deepEqual(body.transactions, []);
    const batch = body.tx as unknown as Batch;
    assert.equal(batch.TransactionType, "Batch");
    assert.equal(batch.Account, wanda.address);
    assert.equal(batch.Sequence, WALLET_SEQUENCE);
    assert.equal(batch.LastLedgerSequence, LEDGER_INDEX + SIGNING_WINDOW_LEDGERS);
    assert.equal(batch.TxnSignature, undefined);
    assert.deepEqual(
      batch.RawTransactions.map(({ RawTransaction }) => [RawTransaction.TransactionType, RawTransaction.Account]),
      [
        ["CredentialCreate", wanda.address],
        ["MPTokenIssuanceCreate", wanda.address],
        ["MPTokenAuthorize", actors.bari.address],
        ["Payment", wanda.address],
      ],
    );
    assert.deepEqual(
      (batch.BatchSigners ?? []).map(({ BatchSigner }) => [BatchSigner.Account, BatchSigner.SigningPubKey]),
      [[actors.bari.address, actors.bari.publicKey]],
    );
    assert.equal(submitted.length, before);
  });

  test("certificat : un blob modifié (frais, BatchSigners de Bari retirés) est refusé en 400, sans soumission", async () => {
    const body = await preparedCertificate();
    const before = submitted.length;
    const modified = await submitBlob("certificate", sessions.wanda, signed(wanda, { ...body.tx, Fee: "1000" }));
    assert.equal(modified.statusCode, HTTP_BAD_REQUEST);
    assert.equal(modified.json<{ error: string }>().error, NOT_PREPARED);
    const { BatchSigners: _bari, ...withoutBari } = body.tx;
    const unsigned = await submitBlob("certificate", sessions.wanda, signed(wanda, withoutBari));
    assert.equal(unsigned.statusCode, HTTP_BAD_REQUEST);
    assert.equal(submitted.length, before);
  });

  test("certificat : si la séquence de Bari a avancé depuis la préparation, 409 sans soumission", async () => {
    const body = await preparedCertificate();
    const before = submitted.length;
    bariSequence += 1;
    try {
      const response = await submitBlob("certificate", sessions.wanda, signed(wanda, body.tx));
      assert.equal(response.statusCode, HTTP_CONFLICT, response.body);
      assert.match(response.json<{ error: string }>().error, /Start again/);
    } finally {
      bariSequence = BARI_SEQUENCE;
    }
    assert.equal(submitted.length, before);
  });

  test("certificat : le blob exact est soumis tel quel, puis enregistré comme pour un compte géré", async () => {
    const body = await preparedCertificate();
    const txBlob = signed(wanda, body.tx);
    const response = await submitBlob("certificate", sessions.wanda, txBlob);
    assert.equal(response.statusCode, HTTP_CREATED, response.body);
    assert.equal(submitted.at(-1), txBlob);
    const issued = response.json<CertificateResponse>();
    tokenId = issued.tokenId;
    const batch = body.tx as unknown as Batch;
    assert.equal(tokenId, invoiceTokenId(wanda.address, batch.RawTransactions[1].RawTransaction.Sequence ?? 0));
    assert.equal(issued.nullifier, wandaCertificate.nullifier);
    assert.equal(issued.pseudonym, wandaCertificate.pseudonym);
    const invoice = context.store.current?.invoices.find((candidate) => candidate.tokenId === tokenId);
    assert.equal(invoice?.owner, wanda.address);
    assert.equal(invoice?.txHash, hashes.hashSignedTx(txBlob));

    const again = await submitBlob("certificate", sessions.wanda, txBlob);
    assert.equal(again.statusCode, HTTP_CONFLICT);
  });

  test("certificat : la même facture déjà enregistrée est refusée en 409 avant toute signature", async () => {
    const response = await inject("POST", "/api/sme/certificate", sessions.wanda, wandaProof());
    assert.equal(response.statusCode, HTTP_CONFLICT, response.body);
    assert.match(response.json<{ hash: string }>().hash, /^[0-9A-F]{64}$/);
  });

  test("prêt : contrôles de Bari passés, LoanSet préparé pour Otsu, ni co-signé ni soumis", async () => {
    const before = submitted.length;
    const response = await inject("POST", "/api/sme/loan", sessions.wanda, { tokenId });
    assert.equal(response.statusCode, HTTP_OK, response.body);
    const body = response.json<LoanSignature>();
    assert.equal(body.status, "sign");
    assert.ok(body.checks.every((check) => check.ok));
    assert.equal(body.tx.TransactionType, "LoanSet");
    assert.equal(body.tx.Account, wanda.address);
    assert.equal(body.tx.PrincipalRequested, "9000");
    assert.equal(body.tx.Sequence, WALLET_SEQUENCE);
    assert.equal(body.tx.LastLedgerSequence, LEDGER_INDEX + SIGNING_WINDOW_LEDGERS);
    assert.equal(body.tx.CounterpartySignature, undefined);
    assert.equal(submitted.length, before);
  });

  test("prêt : un LoanSet modifié est refusé en 400, Bari ne co-signe rien", async () => {
    const body = (await inject("POST", "/api/sme/loan", sessions.wanda, { tokenId })).json<LoanSignature>();
    const before = submitted.length;
    const response = await submitBlob("loan", sessions.wanda, signed(wanda, { ...body.tx, PrincipalRequested: "18000" }));
    assert.equal(response.statusCode, HTTP_BAD_REQUEST);
    assert.equal(response.json<{ error: string }>().error, NOT_PREPARED);
    assert.equal(submitted.length, before);
  });

  test("prêt : le LoanSet signé tel quel est co-signé par Bari, soumis, puis enregistré comme pour un compte géré", async () => {
    const body = (await inject("POST", "/api/sme/loan", sessions.wanda, { tokenId })).json<LoanSignature>();
    const txBlob = signed(wanda, body.tx);
    const response = await submitBlob("loan", sessions.wanda, txBlob);
    assert.equal(response.statusCode, HTTP_CREATED, response.body);
    const loan = response.json<LoanResponse>();
    assert.equal(loan.loanId, LOAN_ID);
    assert.equal(loan.tokenId, tokenId);
    assert.equal(loan.principal, "9000000000");
    assert.equal(loan.netAdvance, "8955000000");

    const sent = decode(submitted.at(-1) ?? "");
    assert.equal(sent.TxnSignature, decode(txBlob).TxnSignature);
    assert.equal((sent.CounterpartySignature as { SigningPubKey: string }).SigningPubKey, actors.bari.publicKey);
    assert.equal(loan.txHash, hashes.hashSignedTx(submitted.at(-1) ?? ""));
    const record = context.store.current?.loans.find((candidate) => candidate.loanId === LOAN_ID);
    assert.equal(record?.borrower, wanda.address);

    const invoices = (await inject("GET", "/api/business/invoices", sessions.wanda)).json<BusinessInvoice[]>();
    assert.deepEqual(
      invoices.map(({ tokenId: id, status, loanId }) => ({ id, status, loanId })),
      [{ id: tokenId, status: "active", loanId: LOAN_ID }],
    );
  });

  test("compte géré : rien n'attend de signature, les routes de soumission répondent 409", async () => {
    for (const route of ["certificate", "loan"] as const) {
      const response = await submitBlob(route, sessions.marco, signed(marco, { TransactionType: "AccountSet", Account: marco.address, Fee: "12", Sequence: 1 }));
      assert.equal(response.statusCode, HTTP_CONFLICT);
    }
  });
});
