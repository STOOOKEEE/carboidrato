// Contrôles de Bari avant co-signature, sur un faux Ledger : une facture déjà financée par un fonds Bari est refusée partout.

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { Wallet, type LedgerEntry, type TxResponse } from "xrpl";
import { ACTOR_NAMES, type Actors } from "../accounts/actors.js";
import type { Fund } from "../fund/fund.js";
import { encodeLoanData, type LoanReference } from "../fund/loanData.js";
import { produceInvoiceCertificate, verifiedDebtorsRoot, type InvoiceCertificate } from "../invoice/certificate.js";
import { DEMO_DEBTOR } from "../invoice/debtors.js";
import { INVOICE_TOKEN_SUPPLY } from "../invoice/invoiceToken.js";
import { centsToUnits } from "../lib/amounts.js";
import { textToHex } from "../lib/encoding.js";
import { CREDENTIAL_TYPES } from "../kyb/kycCredentials.js";
import { FakeLedger } from "../xrpl/fakeLedger.js";
import { releaseZkResources } from "../zk/index.js";
import { verifyBeforeCosigning } from "./loanChecks.js";

const NETWORK_ID = 1000;
const VINTAGE = 2026;
const LSF_CREDENTIAL_ACCEPTED = 0x00010000;
const INVOICE_TOKEN_ID = "00000001".padEnd(48, "A");
const OTHER_NULLIFIER = "B".repeat(64);
/** 10 000 € de facture prouvée, 5 000 € demandés, 100 000 € d'actif par fonds. */
const THRESHOLD_CENTS = 1_000_000;
const PRINCIPAL = centsToUnits(500_000);
const FUND_ASSETS = centsToUnits(10_000_000);

const hex64 = (digit: string) => digit.repeat(64);

const actors = Object.fromEntries(ACTOR_NAMES.map((name) => [name, Wallet.generate()])) as Actors;
let certificate: InvoiceCertificate;
let reference: LoanReference;

function makeFund(brokerDigit: string, vaultDigit: string, debtorsRoot: string): Fund {
  return {
    assetId: INVOICE_TOKEN_ID,
    domainId: hex64("D"),
    cohort: { vaultId: hex64(vaultDigit), shareMptId: INVOICE_TOKEN_ID, subscriptionDate: 0, redemptionDate: 0 },
    brokerId: hex64(brokerDigit),
    manifest: { debtorsRoot, vintage: VINTAGE, registry: actors.bari_registry.address },
  };
}

/** Fonds Bari en place sur le faux ledger : Vault, LoanBroker possédé par Bari et son pseudo-compte. */
function addFund(ledger: FakeLedger, fund: Fund, pseudoAccount: string): void {
  ledger.putVault({ index: fund.cohort.vaultId, AssetsTotal: FUND_ASSETS.toString() } as LedgerEntry.Vault);
  ledger.putLoanBroker({
    LedgerEntryType: "LoanBroker",
    index: fund.brokerId,
    Owner: actors.bari.address,
    Account: pseudoAccount,
    VaultID: fund.cohort.vaultId,
  } as LedgerEntry.LoanBroker);
}

/** Prêt en cours dans un fonds : objet Loan du pseudo-compte et LoanSet d'origine portant la référence. */
function addLoan(ledger: FakeLedger, fund: Fund, pseudoAccount: string, loanReference: LoanReference): void {
  const loanId = hex64("E");
  const loanSetHash = hex64("F");
  ledger.putAccountObject(pseudoAccount, "loan", {
    LedgerEntryType: "Loan",
    index: loanId,
    LoanBrokerID: fund.brokerId,
    LoanSequence: 1,
    PreviousTxnID: loanSetHash,
    PrincipalOutstanding: PRINCIPAL.toString(),
    Borrower: actors.sme.address,
  } as LedgerEntry.Loan);
  ledger.putTransaction({
    hash: loanSetHash,
    validated: true,
    tx_json: {
      TransactionType: "LoanSet",
      Account: actors.sme.address,
      LoanBrokerID: fund.brokerId,
      PrincipalRequested: PRINCIPAL.toString(),
      Data: encodeLoanData(loanReference),
    },
    meta: {
      TransactionIndex: 0,
      TransactionResult: "tesSUCCESS",
      AffectedNodes: [{ CreatedNode: { LedgerEntryType: "Loan", LedgerIndex: loanId, NewFields: {} } }],
    },
  } as TxResponse["result"]);
}

/** Ledger où la PME a son KYB, a enregistré N et a confié son MPT facture à Bari ; fonds A et B ouverts. */
function ledgerWithCertificate(): FakeLedger {
  const ledger = new FakeLedger(NETWORK_ID);
  ledger.putCredential({
    LedgerEntryType: "Credential",
    Subject: actors.sme.address,
    Issuer: actors.kyb_issuer.address,
    CredentialType: textToHex(CREDENTIAL_TYPES.kybSme),
    Flags: LSF_CREDENTIAL_ACCEPTED,
  } as LedgerEntry.Credential);
  ledger.putCredential({
    LedgerEntryType: "Credential",
    Subject: actors.bari_registry.address,
    Issuer: actors.sme.address,
    CredentialType: certificate.nullifier,
    Flags: 0,
  } as LedgerEntry.Credential);
  ledger.putMptIssuance(INVOICE_TOKEN_ID, {
    LedgerEntryType: "MPTokenIssuance",
    Issuer: actors.sme.address,
    MPTokenMetadata: certificate.metadataHex,
  } as LedgerEntry.MPTokenIssuance);
  ledger.putMptBalance(INVOICE_TOKEN_ID, actors.bari.address, INVOICE_TOKEN_SUPPLY);
  return ledger;
}

before(async () => {
  certificate = await produceInvoiceCertificate({
    invoice: {
      debtor: DEMO_DEBTOR,
      number: "IT-PA-2026-000777",
      issueDate: new Date("2026-11-01T00:00:00Z"),
      dueDate: new Date("2027-02-18T00:00:00Z"),
      amountEur: 12_000,
    },
    smeAccount: actors.sme.address,
    registry: actors.bari_registry.address,
    networkId: NETWORK_ID,
    vintage: VINTAGE,
    thresholdCents: BigInt(THRESHOLD_CENTS),
  });
  reference = { nullifier: certificate.nullifier, invoiceTokenId: INVOICE_TOKEN_ID, pseudonym: certificate.pseudonym };
});

after(releaseZkResources);

describe("unicité de N parmi tous les fonds de Bari", () => {
  test("N financé dans le fonds A → refus dans le fonds B", async () => {
    const root = await verifiedDebtorsRoot();
    const fundA = makeFund("A", "1", root);
    const fundB = makeFund("C", "2", root);
    const ledger = ledgerWithCertificate();
    addFund(ledger, fundA, actors.investor_1.address);
    addFund(ledger, fundB, actors.investor_2.address);
    addLoan(ledger, fundA, actors.investor_1.address, reference);

    await assert.rejects(
      verifyBeforeCosigning(ledger, actors, fundB, reference, PRINCIPAL),
      /déjà référencée par un prêt d'un fonds Bari/,
    );
  });

  test("N jamais financé : le fonds B co-signe, même si le fonds A prête sur une autre facture", async () => {
    const root = await verifiedDebtorsRoot();
    const fundA = makeFund("A", "1", root);
    const fundB = makeFund("C", "2", root);
    const ledger = ledgerWithCertificate();
    addFund(ledger, fundA, actors.investor_1.address);
    addFund(ledger, fundB, actors.investor_2.address);
    addLoan(ledger, fundA, actors.investor_1.address, { ...reference, nullifier: OTHER_NULLIFIER });

    await verifyBeforeCosigning(ledger, actors, fundB, reference, PRINCIPAL);
  });
});
