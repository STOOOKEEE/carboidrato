// Route GET /api/audit sur un faux Ledger : prêts relus avec la preuve brute de leur facture, prix de la part, 404 sans fonds.

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { isoTimeToRippleTime, Wallet, type LedgerEntry, type TxResponse } from "xrpl";
import type { Fund } from "../../../fund/fund.js";
import { encodeFundManifest } from "../../../fund/fundManifest.js";
import { encodeLoanData } from "../../../fund/loanData.js";
import { produceInvoiceCertificate, verifiedDebtorsRoot, type InvoiceCertificate } from "../../../invoice/certificate.js";
import { decodeCertificateMetadata } from "../../../invoice/certificateMetadata.js";
import { DEMO_DEBTOR } from "../../../invoice/debtors.js";
import { INVOICE_TOKEN_SUPPLY } from "../../../invoice/invoiceToken.js";
import { FakeLedger } from "../../../xrpl/fakeLedger.js";
import { RLUSD_CURRENCY } from "../../../xrpl/stablecoin.js";
import { PUBLIC_SIGNAL_ORDER, releaseZkResources } from "../../../zk/index.js";
import { PROOF_PUBLIC_SIGNALS, type FundAudit } from "../../contract.js";
import { buildApp } from "../app.js";
import { fakeApiConfig, fakeContext } from "../fakeContext.js";

const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const NETWORK_ID = 1000;
const VINTAGE = 2026;
const VAULT_ID = "0C".repeat(32);
const BROKER_ID = "0D".repeat(32);
const SHARE_ID = "0B".repeat(24);
const INVOICE_TOKEN_ID = "0A".repeat(24);
const LOAN_ID = "1A".repeat(32);
const LOAN_SET_HASH = "2A".repeat(32);
/** Principal du prêt : valeur RLUSD du ledger, et en unités dans la réponse. */
const PRINCIPAL = "9000";
const PRINCIPAL_UNITS = "9000000000";
/** 100 500 RLUSD d'actif pour 100 000 parts affichées : 1,005 RLUSD la part. */
const ASSETS_TOTAL = "100500";
const ASSETS_TOTAL_UNITS = "100500000000";
const SHARES_OUTSTANDING = "100000000000";
const DUE_DATE_ISO = "2027-02-18T00:00:00.000Z";

const business = Wallet.generate();
const brokerAccount = Wallet.generate().address;
let certificate: InvoiceCertificate;

function fundOf(registry: string, debtorsRoot: string): Fund {
  return {
    stablecoin: { currency: RLUSD_CURRENCY, issuer: Wallet.generate().address },
    domainId: "0F".repeat(32),
    brokerId: BROKER_ID,
    cohort: { vaultId: VAULT_ID, shareMptId: SHARE_ID, subscriptionDate: 0, redemptionDate: 10_000 },
    manifest: { debtorsRoot, vintage: VINTAGE, registry },
  };
}

/** Fonds avec un prêt en cours : Vault, LoanBroker, parts émises, LoanSet portant la référence, certificat et N enregistré. */
function ledgerWithLoan(fund: Fund, bari: string): FakeLedger {
  const ledger = new FakeLedger(NETWORK_ID);
  ledger.putVault({
    LedgerEntryType: "Vault",
    index: VAULT_ID,
    Owner: bari,
    Data: encodeFundManifest(fund.manifest),
    AssetsTotal: ASSETS_TOTAL,
    AssetsAvailable: "91500",
    LossUnrealized: "0",
  } as LedgerEntry.Vault);
  ledger.putLoanBroker({
    LedgerEntryType: "LoanBroker",
    index: BROKER_ID,
    Owner: bari,
    Account: brokerAccount,
    VaultID: VAULT_ID,
    CoverAvailable: "1000",
    DebtTotal: PRINCIPAL,
  } as LedgerEntry.LoanBroker);
  ledger.putMptIssuance(SHARE_ID, { LedgerEntryType: "MPTokenIssuance", OutstandingAmount: SHARES_OUTSTANDING } as LedgerEntry.MPTokenIssuance);
  ledger.putAccountObject(brokerAccount, "loan", {
    LedgerEntryType: "Loan",
    index: LOAN_ID,
    Flags: 0,
    LoanBrokerID: BROKER_ID,
    LoanSequence: 1,
    PreviousTxnID: LOAN_SET_HASH,
    PrincipalOutstanding: PRINCIPAL,
    NextPaymentDueDate: isoTimeToRippleTime(DUE_DATE_ISO),
    Borrower: business.address,
  } as LedgerEntry.Loan);
  ledger.putTransaction({
    hash: LOAN_SET_HASH,
    validated: true,
    tx_json: {
      TransactionType: "LoanSet",
      Account: business.address,
      LoanBrokerID: BROKER_ID,
      PrincipalRequested: PRINCIPAL,
      Data: encodeLoanData({ nullifier: certificate.nullifier, invoiceTokenId: INVOICE_TOKEN_ID, pseudonym: certificate.pseudonym }),
    },
    meta: {
      TransactionIndex: 0,
      TransactionResult: "tesSUCCESS",
      AffectedNodes: [{ CreatedNode: { LedgerEntryType: "Loan", LedgerIndex: LOAN_ID, NewFields: {} } }],
    },
  } as TxResponse["result"]);
  ledger.putCredential({
    LedgerEntryType: "Credential",
    Subject: fund.manifest.registry,
    Issuer: business.address,
    CredentialType: certificate.nullifier,
    Flags: 0,
  } as LedgerEntry.Credential);
  ledger.putMptIssuance(INVOICE_TOKEN_ID, {
    LedgerEntryType: "MPTokenIssuance",
    Issuer: business.address,
    MPTokenMetadata: certificate.metadataHex,
  } as LedgerEntry.MPTokenIssuance);
  ledger.putMptBalance(INVOICE_TOKEN_ID, bari, INVOICE_TOKEN_SUPPLY);
  return ledger;
}

/** Comptes de démo communs : le registre prouvé par le certificat est celui de la fiche du fonds. */
const { actors } = fakeContext();

async function appWith(withFund: boolean): Promise<{ app: FastifyInstance; fund: Fund }> {
  const base = fakeContext({ actors });
  const fund = fundOf(actors.bari_registry.address, await verifiedDebtorsRoot());
  const context = { ...base, ledger: ledgerWithLoan(fund, actors.bari.address) };
  if (withFund) context.store.reset(fund);
  const app = await buildApp(fakeApiConfig, context);
  await app.ready();
  return { app, fund };
}

before(async () => {
  const registry = actors.bari_registry.address;
  certificate = await produceInvoiceCertificate({
    invoice: {
      debtor: DEMO_DEBTOR,
      number: "IT-PA-2026-000999",
      issueDate: new Date("2026-11-01T00:00:00Z"),
      dueDate: new Date(DUE_DATE_ISO),
      amountEur: 12_000,
    },
    smeAccount: business.address,
    registry,
    networkId: NETWORK_ID,
    vintage: VINTAGE,
    thresholdCents: 1_000_000n,
  });
});

after(releaseZkResources);

describe("GET /api/audit", () => {
  test("chaque prêt expose la preuve brute et ses signaux publics, montants en chaînes", async () => {
    const { app, fund } = await appWith(true);
    try {
      const response = await app.inject({ method: "GET", url: "/api/audit" });
      assert.equal(response.statusCode, HTTP_OK, response.body);
      const audit = response.json<FundAudit>();
      assert.equal(audit.loans, 1);
      assert.equal(audit.verifiedProofs, 1);
      assert.equal(audit.anomalies, 0);
      assert.equal(audit.vaultId, VAULT_ID);
      assert.equal(audit.brokerId, BROKER_ID);
      assert.deepEqual(audit.manifest, fund.manifest);
      assert.equal(audit.fundAssets, ASSETS_TOTAL_UNITS);
      assert.equal(audit.sharePrice, "1005000");
      assert.equal(audit.concentrationLimitPercent, 20);

      const [loan] = audit.loanAudits;
      assert.equal(audit.loanAudits.length, 1);
      assert.equal(loan.loanId, LOAN_ID);
      assert.equal(loan.loanSetHash, LOAN_SET_HASH);
      assert.equal(loan.borrower, business.address);
      assert.equal(loan.principal, PRINCIPAL_UNITS);
      assert.equal(loan.outstanding, PRINCIPAL_UNITS);
      assert.equal(loan.status, "active");
      assert.equal(loan.dueDate, DUE_DATE_ISO);
      assert.equal(loan.anomalies, 0);
      assert.deepEqual(loan.reference, {
        nullifier: certificate.nullifier,
        pseudonym: certificate.pseudonym,
        invoiceTokenId: INVOICE_TOKEN_ID,
      });
      const { proof } = decodeCertificateMetadata(certificate.metadataHex);
      assert.deepEqual(loan.certificate, {
        proof: {
          pi_a: proof.proof.pi_a,
          pi_b: proof.proof.pi_b,
          pi_c: proof.proof.pi_c,
          protocol: proof.proof.protocol,
          curve: proof.proof.curve,
        },
        publicSignals: proof.publicSignals,
      });
    } finally {
      await app.close();
    }
  });

  test("sans fonds ouvert : 404", async () => {
    const { app } = await appWith(false);
    try {
      const response = await app.inject({ method: "GET", url: "/api/audit" });
      assert.equal(response.statusCode, HTTP_NOT_FOUND);
    } finally {
      await app.close();
    }
  });

  test("le contrat publie au navigateur l'ordre des signaux publics du circuit", () => {
    assert.deepEqual(PROOF_PUBLIC_SIGNALS, PUBLIC_SIGNAL_ORDER);
  });
});
