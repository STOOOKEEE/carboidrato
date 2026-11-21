// Contrôles de Bari avant co-signature, sur un faux Ledger : chacun rendu avec sa raison, pour le compte de l'entreprise.

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { isoTimeToRippleTime, Wallet, type LedgerEntry, type TxResponse } from "xrpl";
import type { Fund } from "../fund/fund.js";
import { encodeLoanData, type LoanReference } from "../fund/loanData.js";
import { produceInvoiceCertificate, verifiedDebtorsRoot, type InvoiceCertificate } from "../invoice/certificate.js";
import { DEMO_DEBTOR } from "../invoice/debtors.js";
import { INVOICE_TOKEN_SUPPLY } from "../invoice/invoiceToken.js";
import { CREDENTIAL_TYPES } from "../kyb/kycCredentials.js";
import { rlusdToUnits } from "../lib/amounts.js";
import { textToHex } from "../lib/encoding.js";
import { FakeLedger } from "../xrpl/fakeLedger.js";
import { RLUSD_CURRENCY, unitsToValue } from "../xrpl/stablecoin.js";
import { releaseZkResources } from "../zk/index.js";
import { refusalReason, reviewLoan, type LoanParties } from "./loanChecks.js";

const NETWORK_ID = 1000;
const VINTAGE = 2026;
const LSF_CREDENTIAL_ACCEPTED = 0x00010000;
const INVOICE_TOKEN_ID = "00000001".padEnd(48, "A");
const OTHER_NULLIFIER = "B".repeat(64);
/** 100 000 RLUSD d'actif par fonds : 9 000 RLUSD sur un débiteur restent sous le plafond de 20 %. */
const FUND_ASSETS = rlusdToUnits(100_000);
const NOW = isoTimeToRippleTime("2026-11-21T10:00:00Z");
const INVOICE_DUE_DATE = isoTimeToRippleTime("2027-02-18T00:00:00Z");
const REDEMPTION_DATE = isoTimeToRippleTime("2027-03-31T00:00:00Z");

const hex64 = (digit: string) => digit.repeat(64);

const business = Wallet.generate();
const bari = Wallet.generate();
const kybIssuer = Wallet.generate();
const registry = Wallet.generate();
const pseudoAccounts = [Wallet.generate().address, Wallet.generate().address];
const parties: LoanParties = { borrower: business.address, bari: bari.address, kybIssuer: kybIssuer.address };
/** Facture de 12 000 $ prouvée au palier de 10 000 $, et une de 4 500 $ prouvée à 4 000 $ (sous le premier palier). */
let certificate: InvoiceCertificate;
let belowTierCertificate: InvoiceCertificate;

function makeFund(brokerDigit: string, vaultDigit: string, debtorsRoot: string): Fund {
  return {
    stablecoin: { currency: RLUSD_CURRENCY, issuer: Wallet.generate().address },
    domainId: hex64("D"),
    cohort: { vaultId: hex64(vaultDigit), shareMptId: INVOICE_TOKEN_ID, subscriptionDate: 0, redemptionDate: REDEMPTION_DATE },
    brokerId: hex64(brokerDigit),
    manifest: { debtorsRoot, vintage: VINTAGE, registry: registry.address },
  };
}

/** Fonds Bari en place sur le faux ledger : Vault, LoanBroker possédé par Bari et son pseudo-compte. */
function addFund(ledger: FakeLedger, fund: Fund, pseudoAccount: string, assets = FUND_ASSETS): void {
  ledger.putVault({ index: fund.cohort.vaultId, AssetsTotal: unitsToValue(assets) } as LedgerEntry.Vault);
  ledger.putLoanBroker({
    LedgerEntryType: "LoanBroker",
    index: fund.brokerId,
    Owner: bari.address,
    Account: pseudoAccount,
    VaultID: fund.cohort.vaultId,
  } as LedgerEntry.LoanBroker);
}

/** Prêt en cours dans un fonds : objet Loan du pseudo-compte et LoanSet d'origine portant la référence. */
function addLoan(ledger: FakeLedger, fund: Fund, pseudoAccount: string, loanReference: LoanReference): void {
  const loanId = hex64("E");
  const loanSetHash = hex64("F");
  const principal = unitsToValue(rlusdToUnits(5_000));
  ledger.putAccountObject(pseudoAccount, "loan", {
    LedgerEntryType: "Loan",
    index: loanId,
    LoanBrokerID: fund.brokerId,
    LoanSequence: 1,
    PreviousTxnID: loanSetHash,
    PrincipalOutstanding: principal,
    Borrower: business.address,
  } as LedgerEntry.Loan);
  ledger.putTransaction({
    hash: loanSetHash,
    validated: true,
    tx_json: {
      TransactionType: "LoanSet",
      Account: business.address,
      LoanBrokerID: fund.brokerId,
      PrincipalRequested: principal,
      Data: encodeLoanData(loanReference),
    },
    meta: {
      TransactionIndex: 0,
      TransactionResult: "tesSUCCESS",
      AffectedNodes: [{ CreatedNode: { LedgerEntryType: "Loan", LedgerIndex: loanId, NewFields: {} } }],
    },
  } as TxResponse["result"]);
}

interface LedgerOptions {
  kyb?: boolean;
  heldByBari?: boolean;
  invoice?: InvoiceCertificate;
}

/** Ledger où l'entreprise a son KYB, a enregistré N et a confié son MPT facture à Bari. */
function ledgerWithCertificate({ kyb = true, heldByBari = true, invoice = certificate }: LedgerOptions = {}): FakeLedger {
  const ledger = new FakeLedger(NETWORK_ID);
  ledger.setCloseTime(NOW);
  if (kyb) {
    ledger.putCredential({
      LedgerEntryType: "Credential",
      Subject: business.address,
      Issuer: kybIssuer.address,
      CredentialType: textToHex(CREDENTIAL_TYPES.kybSme),
      Flags: LSF_CREDENTIAL_ACCEPTED,
    } as LedgerEntry.Credential);
  }
  ledger.putCredential({
    LedgerEntryType: "Credential",
    Subject: registry.address,
    Issuer: business.address,
    CredentialType: invoice.nullifier,
    Flags: 0,
  } as LedgerEntry.Credential);
  ledger.putMptIssuance(INVOICE_TOKEN_ID, {
    LedgerEntryType: "MPTokenIssuance",
    Issuer: business.address,
    MPTokenMetadata: invoice.metadataHex,
  } as LedgerEntry.MPTokenIssuance);
  if (heldByBari) ledger.putMptBalance(INVOICE_TOKEN_ID, bari.address, INVOICE_TOKEN_SUPPLY);
  return ledger;
}

const referenceOf = (invoice: InvoiceCertificate): LoanReference => ({
  nullifier: invoice.nullifier,
  invoiceTokenId: INVOICE_TOKEN_ID,
  pseudonym: invoice.pseudonym,
});

function prove(number: string, amountUsd: number, thresholdCents: bigint): Promise<InvoiceCertificate> {
  return produceInvoiceCertificate({
    invoice: {
      debtor: DEMO_DEBTOR,
      number,
      issueDate: new Date("2026-11-01T00:00:00Z"),
      dueDate: new Date("2027-02-18T00:00:00Z"),
      amountUsd,
    },
    smeAccount: business.address,
    registry: registry.address,
    networkId: NETWORK_ID,
    vintage: VINTAGE,
    thresholdCents,
  });
}

/** Un fonds ouvert, la facture du compte de l'entreprise prête à financer. */
async function openFund(options: LedgerOptions & { assets?: bigint } = {}) {
  const fund = makeFund("A", "1", await verifiedDebtorsRoot());
  const ledger = ledgerWithCertificate(options);
  addFund(ledger, fund, pseudoAccounts[0], options.assets);
  return { fund, ledger };
}

const failed = (checks: { id: string; ok: boolean }[]) => checks.filter((check) => !check.ok).map((check) => check.id);
const reasonOf = (checks: { id: string; reason?: string }[], id: string) => checks.find((check) => check.id === id)?.reason;

before(async () => {
  certificate = await prove("IT-PA-2026-000777", 12_000, 1_000_000n);
  belowTierCertificate = await prove("IT-PA-2026-000778", 4_500, 400_000n);
});

after(releaseZkResources);

describe("contrôles avant co-signature", () => {
  test("facture conforme : six contrôles passés dans l'ordre, avance de 90 % du palier prouvé", async () => {
    const { fund, ledger } = await openFund();
    const review = await reviewLoan(ledger, parties, fund, referenceOf(certificate));
    assert.deepEqual(
      review.checks.map(({ id, ok }) => ({ id, ok })),
      ["kyb", "proof", "advance", "unique", "concentration", "maturity"].map((id) => ({ id, ok: true })),
    );
    assert.ok(review.checks.every((check) => check.label.length > 0 && check.reason === undefined));
    assert.equal(review.approval?.terms.principal, rlusdToUnits(9_000));
    assert.equal(review.approval?.terms.originationFee, rlusdToUnits(45));
    assert.equal(review.approval?.certificate.account, business.address);
    assert.equal(refusalReason(review.checks), undefined);
  });

  test("KYB absent sur le compte de l'entreprise : refus KYB", async () => {
    const { fund, ledger } = await openFund({ kyb: false });
    const review = await reviewLoan(ledger, parties, fund, referenceOf(certificate));
    assert.deepEqual(failed(review.checks), ["kyb"]);
    assert.match(reasonOf(review.checks, "kyb") ?? "", /KYB_PME/);
    assert.equal(review.approval, undefined);
    assert.equal(refusalReason(review.checks), reasonOf(review.checks, "kyb"));
  });

  test("certificat d'un autre compte : la preuve ne lie pas l'emprunteur", async () => {
    const { fund, ledger } = await openFund();
    const other = { ...parties, borrower: Wallet.generate().address };
    const review = await reviewLoan(ledger, other, fund, referenceOf(certificate));
    assert.ok(failed(review.checks).includes("proof"));
    assert.match(reasonOf(review.checks, "proof") ?? "", /certificate/i);
  });

  test("MPT facture non remis à Bari : refus de la preuve", async () => {
    const { fund, ledger } = await openFund({ heldByBari: false });
    const review = await reviewLoan(ledger, parties, fund, referenceOf(certificate));
    assert.deepEqual(failed(review.checks), ["proof"]);
    assert.match(reasonOf(review.checks, "proof") ?? "", /Atlas does not hold/);
  });

  test("seuil prouvé sous le premier palier : refus de l'avance", async () => {
    const { fund, ledger } = await openFund({ invoice: belowTierCertificate });
    const review = await reviewLoan(ledger, parties, fund, referenceOf(belowTierCertificate));
    assert.equal(failed(review.checks)[0], "advance");
    assert.match(reasonOf(review.checks, "advance") ?? "", /smallest tier/);
    assert.equal(refusalReason(review.checks), reasonOf(review.checks, "advance"));
  });

  test("N financé dans le fonds A → refus d'unicité dans le fonds B", async () => {
    const root = await verifiedDebtorsRoot();
    const fundA = makeFund("A", "1", root);
    const fundB = makeFund("C", "2", root);
    const ledger = ledgerWithCertificate();
    addFund(ledger, fundA, pseudoAccounts[0]);
    addFund(ledger, fundB, pseudoAccounts[1]);
    addLoan(ledger, fundA, pseudoAccounts[0], referenceOf(certificate));

    const review = await reviewLoan(ledger, parties, fundB, referenceOf(certificate));
    assert.deepEqual(failed(review.checks), ["unique"]);
    assert.match(reasonOf(review.checks, "unique") ?? "", /already financed/);
  });

  test("N jamais financé : le fonds B co-signe, même si le fonds A prête sur une autre facture", async () => {
    const root = await verifiedDebtorsRoot();
    const fundA = makeFund("A", "1", root);
    const fundB = makeFund("C", "2", root);
    const ledger = ledgerWithCertificate();
    addFund(ledger, fundA, pseudoAccounts[0]);
    addFund(ledger, fundB, pseudoAccounts[1]);
    addLoan(ledger, fundA, pseudoAccounts[0], { ...referenceOf(certificate), nullifier: OTHER_NULLIFIER });

    const review = await reviewLoan(ledger, parties, fundB, referenceOf(certificate));
    assert.deepEqual(failed(review.checks), []);
  });

  test("fonds trop petit pour 9 000 RLUSD sur ce débiteur : refus de concentration", async () => {
    const { fund, ledger } = await openFund({ assets: rlusdToUnits(20_000) });
    const review = await reviewLoan(ledger, parties, fund, referenceOf(certificate));
    assert.deepEqual(failed(review.checks), ["concentration"]);
    assert.match(reasonOf(review.checks, "concentration") ?? "", /20 %/);
  });

  test("rachat du fonds trop proche : refus de l'échéance", async () => {
    const { fund, ledger } = await openFund();
    fund.cohort.redemptionDate = NOW + 100;
    const review = await reviewLoan(ledger, parties, fund, referenceOf(certificate));
    assert.deepEqual(failed(review.checks), ["maturity"]);
    assert.match(reasonOf(review.checks, "maturity") ?? "", /too short/);
  });

  test("facture échue : refus de l'échéance", async () => {
    const { fund, ledger } = await openFund();
    ledger.setCloseTime(INVOICE_DUE_DATE + 1);
    const review = await reviewLoan(ledger, parties, fund, referenceOf(certificate));
    assert.deepEqual(failed(review.checks), ["maturity"]);
    assert.match(reasonOf(review.checks, "maturity") ?? "", /due date has passed/);
  });
});
