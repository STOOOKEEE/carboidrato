// Route GET /api/tx/:hash sur un faux Ledger : détail lisible, preuve décodée du MPT facture, 404 et 400.

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import { Wallet, type MPTokenIssuanceCreate } from "xrpl";
import type { NetworkConfig } from "../../../config/network.js";
import { produceInvoiceCertificate, type InvoiceCertificate } from "../../../invoice/certificate.js";
import { DEMO_DEBTOR } from "../../../invoice/debtors.js";
import { FakeLedger } from "../../../xrpl/fakeLedger.js";
import { releaseZkResources } from "../../../zk/index.js";
import type { TxDetail } from "../../contract.js";
import { makeErrorHandler } from "../errors.js";
import { registerTxRoutes } from "./txRoutes.js";

const NETWORK_ID = 1000;
const BATCH_HASH = "A".repeat(64);
const ISSUANCE_HASH = "B".repeat(64);
const ISSUANCE_ID = "C".repeat(48);
const UNKNOWN_HASH = "D".repeat(64);

const sme = Wallet.generate();
const bari = Wallet.generate();
const registry = Wallet.generate();
let certificate: InvoiceCertificate;

const alphanet: NetworkConfig = {
  wsUrl: "wss://alphanet.example",
  faucetHost: "",
  genesisSeed: undefined,
  walletsFile: ".wallets.alphanet.json",
  explorerUrl: "https://devnet.xrpl.org",
  hasExplorer: false,
};
const devnet: NetworkConfig = { ...alphanet, hasExplorer: true };

function issuanceTx(): MPTokenIssuanceCreate {
  return {
    TransactionType: "MPTokenIssuanceCreate",
    Account: sme.address,
    MPTokenMetadata: certificate.metadataHex,
    MaximumAmount: "1",
  };
}

/** Certificat émis en Batch : enregistrement de N et MPT facture portant la preuve dans ses métadonnées. */
function ledgerWithCertificate(): FakeLedger {
  const ledger = new FakeLedger(NETWORK_ID);
  ledger.putTransaction({
    hash: BATCH_HASH,
    validated: true,
    ledger_index: 42,
    close_time_iso: "2026-11-21T10:00:00Z",
    tx_json: {
      TransactionType: "Batch",
      Account: sme.address,
      Flags: 0x00010000,
      Fee: "40",
      RawTransactions: [
        {
          RawTransaction: {
            TransactionType: "CredentialCreate",
            Account: sme.address,
            Subject: registry.address,
            CredentialType: certificate.nullifier,
            Flags: 0x40000000,
            Fee: "0",
            Sequence: 11,
            SigningPubKey: "",
          },
        },
        { RawTransaction: { ...issuanceTx(), Flags: 0x40000000, Fee: "0", Sequence: 12, SigningPubKey: "" } },
      ],
      BatchSigners: [{ BatchSigner: { Account: bari.address, SigningPubKey: "", TxnSignature: "" } }],
    },
    meta: { TransactionIndex: 0, TransactionResult: "tesSUCCESS", AffectedNodes: [] },
  });
  ledger.putTransaction({
    hash: ISSUANCE_HASH,
    validated: true,
    tx_json: issuanceTx(),
    meta: {
      TransactionIndex: 1,
      TransactionResult: "tesSUCCESS",
      AffectedNodes: [{ CreatedNode: { LedgerEntryType: "MPTokenIssuance", LedgerIndex: ISSUANCE_ID, NewFields: {} } }],
    },
  });
  return ledger;
}

async function appFor(network: NetworkConfig): Promise<FastifyInstance> {
  const app = Fastify();
  app.setErrorHandler(makeErrorHandler((hash) => hash));
  registerTxRoutes(app, { ledger: ledgerWithCertificate(), network });
  await app.ready();
  return app;
}

before(async () => {
  certificate = await produceInvoiceCertificate({
    invoice: {
      debtor: DEMO_DEBTOR,
      number: "IT-PA-2026-000888",
      issueDate: new Date("2026-11-01T00:00:00Z"),
      dueDate: new Date("2027-02-18T00:00:00Z"),
      amountEur: 12_000,
    },
    smeAccount: sme.address,
    registry: registry.address,
    networkId: NETWORK_ID,
    vintage: 2026,
    thresholdCents: 1_000_000n,
  });
});

after(releaseZkResources);

describe("GET /api/tx/:hash", () => {
  test("Batch du certificat : transactions internes et preuve décodée du MPT facture", async () => {
    const app = await appFor(alphanet);
    const response = await app.inject({ method: "GET", url: `/api/tx/${BATCH_HASH.toLowerCase()}` });
    assert.equal(response.statusCode, 200);
    const detail = response.json<TxDetail>();
    assert.equal(detail.hash, BATCH_HASH);
    assert.equal(detail.type, "Batch");
    assert.equal(detail.result, "tesSUCCESS");
    assert.equal(detail.validated, true);
    assert.equal(detail.ledgerIndex, 42);
    assert.deepEqual(detail.accounts, [{ role: "Account", address: sme.address }]);
    assert.deepEqual(
      detail.innerTransactions.map(({ type, account }) => ({ type, account })),
      [
        { type: "CredentialCreate", account: sme.address },
        { type: "MPTokenIssuanceCreate", account: sme.address },
      ],
    );
    assert.ok(detail.innerTransactions.every((inner) => /^[0-9A-F]{64}$/.test(inner.hash)));
    assert.equal(detail.certificate?.nullifier, certificate.nullifier);
    assert.equal(detail.certificate?.commitment, certificate.commitment);
    assert.equal(detail.certificate?.pseudonym, certificate.pseudonym);
    assert.equal(detail.certificate?.proofSystem, "groth16");
    assert.equal(detail.certificate?.thresholdCents, 1_000_000);
    assert.equal(detail.certificate?.account, sme.address);
    assert.equal(detail.explorerUrl, undefined);
    await app.close();
  });

  test("MPTokenIssuanceCreate seul : objets créés, champs clés, lien explorer sur devnet", async () => {
    const app = await appFor(devnet);
    const response = await app.inject({ method: "GET", url: `/api/tx/${ISSUANCE_HASH}` });
    assert.equal(response.statusCode, 200);
    const detail = response.json<TxDetail>();
    assert.deepEqual(detail.createdObjects, [{ type: "MPTokenIssuance", index: ISSUANCE_ID }]);
    assert.deepEqual(detail.fields, [{ name: "MaximumAmount", value: "1" }]);
    assert.equal(detail.certificate?.nullifier, certificate.nullifier);
    assert.equal(detail.explorerUrl, `https://devnet.xrpl.org/transactions/${ISSUANCE_HASH}`);
    await app.close();
  });

  test("hash inconnu du nœud : 404", async () => {
    const app = await appFor(alphanet);
    const response = await app.inject({ method: "GET", url: `/api/tx/${UNKNOWN_HASH}` });
    assert.equal(response.statusCode, 404);
    await app.close();
  });

  test("hash invalide : 400", async () => {
    const app = await appFor(alphanet);
    const response = await app.inject({ method: "GET", url: "/api/tx/not-a-hash" });
    assert.equal(response.statusCode, 400);
    await app.close();
  });
});
