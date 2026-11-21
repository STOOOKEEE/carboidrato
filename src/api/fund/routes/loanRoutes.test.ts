// Remboursement d'un prêt : signé par le compte géré de l'entreprise emprunteuse enregistrée, ou par la PME de démo
// pour les prêts de npm run demo:fund ; pour une entreprise wallet, LoanPay préparé puis signé dans Otsu ; soumissions
// et ledger simulés.

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { decode, Wallet, type LedgerEntry, type SubmittableTransaction, type Transaction } from "xrpl";
import type { Fund } from "../../../fund/fund.js";
import { FakeLedger } from "../../../xrpl/fakeLedger.js";
import { SIGNING_WINDOW_LEDGERS, type WalletTxPorts } from "../../../xrpl/preparedTx.js";
import { RLUSD_CURRENCY, type Stablecoin } from "../../../xrpl/stablecoin.js";
import type { TxOutcome } from "../../../xrpl/submit.js";
import type { PreparedSignature } from "../../contract.js";
import { buildApp } from "../app.js";
import { fakeApiConfig, fakeContext } from "../fakeContext.js";
import type { LoanState } from "../stateStore.js";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_CONFLICT = 409;
const TX_HASH = "EE".repeat(32);
const VAULT_ID = "0C".repeat(32);
const BROKER_ID = "0D".repeat(32);
const BUSINESS_LOAN_ID = "1A".repeat(32);
const DEMO_LOAN_ID = "1B".repeat(32);
const LEGACY_LOAN_ID = "1C".repeat(32);
const ORPHAN_LOAN_ID = "1D".repeat(32);
const WALLET_LOAN_ID = "1E".repeat(32);
/** Dû renvoyé par le ledger, au-delà de 6 décimales : le LoanPay l'arrondit à l'unité supérieure. */
const TOTAL_DUE = "9133.1506849315";
const TOTAL_DUE_PAID = "9133.150685";
const WALLET_SEQUENCE = 21;
const LEDGER_INDEX = 900;

const ledger = new FakeLedger(1000);
const sent: { tx: SubmittableTransaction; signer: string }[] = [];
const outcome: TxOutcome = { hash: TX_HASH, result: "tesSUCCESS", meta: { AffectedNodes: [], TransactionIndex: 0, TransactionResult: "tesSUCCESS" } };
let business: Wallet | undefined;
/** Entreprise connectée par son wallet : elle signe son LoanPay dans Otsu. */
const walletBorrower = Wallet.generate();
const walletSubmitted: string[] = [];
const walletPorts: WalletTxPorts = {
  accountState: async () => ({ sequence: WALLET_SEQUENCE, ledgerIndex: LEDGER_INDEX }),
  autofill: async (tx) => ({ ...tx, Fee: "12" }),
  submitSigned: async (txBlob, hash) => {
    walletSubmitted.push(txBlob);
    return { ...outcome, hash };
  },
};

const context = fakeContext({
  ledger,
  provisionAccount: async () => {
    business = Wallet.generate();
    return { address: business.address, seed: business.seed ?? "" };
  },
});
const { actors } = context;
const asset: Stablecoin = { currency: RLUSD_CURRENCY, issuer: actors.stable_issuer.address };
const fund = {
  stablecoin: asset,
  domainId: "0E".repeat(32),
  brokerId: BROKER_ID,
  cohort: { vaultId: VAULT_ID, shareMptId: "0B".repeat(24), subscriptionDate: 0, redemptionDate: 10_000 },
  manifest: { debtorsRoot: "0F".repeat(32), vintage: 2026, registry: actors.bari_registry.address },
} satisfies Fund;

let app: FastifyInstance;

function loanEntry(index: string): LedgerEntry.Loan {
  return {
    LedgerEntryType: "Loan",
    index,
    Flags: 0,
    LoanSequence: 1,
    OwnerNode: "0",
    LoanBrokerNode: "0",
    LoanBrokerID: BROKER_ID,
    Borrower: Wallet.generate().address,
    InterestRate: 6_000,
    StartDate: 0,
    PaymentInterval: 60,
    GracePeriod: 60,
    NextPaymentDueDate: 3_000,
    PaymentRemaining: 1,
    TotalValueOutstanding: TOTAL_DUE,
    PrincipalOutstanding: "9000",
    PeriodicPayment: TOTAL_DUE,
    PreviousTxnID: TX_HASH,
    PreviousTxnLgrSeq: 1,
  };
}

function loanState(loanId: string, tokenByte: string, borrower?: string): LoanState {
  return {
    loanId,
    reference: { nullifier: "AA".repeat(32), invoiceTokenId: tokenByte.repeat(24), pseudonym: "BB".repeat(32) },
    status: "active",
    createdAt: "2026-11-21T10:00:00.000Z",
    ...(borrower === undefined ? {} : { borrower }),
  };
}

function managedBusiness(): Wallet {
  if (business === undefined) throw new Error("entreprise non inscrite");
  return business;
}

const repay = (loanId: string) => app.inject({ method: "POST", url: `/api/loans/${loanId}/repay` });
const signerOf = (type: string) => sent.find(({ tx }) => tx.TransactionType === type);

before(async () => {
  app = await buildApp(fakeApiConfig, context, {
    submit: async (tx, wallet) => {
      sent.push({ tx, signer: wallet.address });
      return outcome;
    },
    submitBatch: async () => outcome,
  }, walletPorts);
  await app.ready();
  context.users.createWalletUser({
    role: "business",
    profile: { company: "Wanda Forniture S.r.l.", vatNumber: "IT05556667778" },
    address: walletBorrower.address,
  });
  const signup = await app.inject({
    method: "POST",
    url: "/api/auth/signup",
    payload: {
      email: "marco@costruzioni.it",
      password: "correct horse battery",
      role: "business",
      profile: { company: "Marco Costruzioni S.r.l.", vatNumber: "IT01234567890" },
    },
  });
  assert.equal(signup.statusCode, 201, signup.body);

  ledger.putVault({ index: VAULT_ID, AssetsTotal: "100000", AssetsAvailable: "91000", LossUnrealized: "0" } as LedgerEntry.Vault);
  ledger.putLoanBroker({ index: BROKER_ID, Owner: actors.bari.address, DebtTotal: TOTAL_DUE } as LedgerEntry.LoanBroker);
  for (const id of [BUSINESS_LOAN_ID, DEMO_LOAN_ID, LEGACY_LOAN_ID, ORPHAN_LOAN_ID, WALLET_LOAN_ID]) ledger.putLoan(loanEntry(id));
  context.store.reset(fund);
  context.store.update((state) => {
    state.loans.push(
      loanState(BUSINESS_LOAN_ID, "01", managedBusiness().address),
      loanState(DEMO_LOAN_ID, "02", actors.sme.address),
      loanState(LEGACY_LOAN_ID, "03"),
      loanState(ORPHAN_LOAN_ID, "04", Wallet.generate().address),
      loanState(WALLET_LOAN_ID, "05", walletBorrower.address),
    );
  });
});

beforeEach(() => {
  sent.length = 0;
});

after(() => app.close());

describe("POST /api/loans/:id/repay", () => {
  test("le prêt d'une entreprise inscrite est remboursé en RLUSD par son compte géré, qui récupère son MPT facture", async () => {
    const borrower = managedBusiness().address;
    const response = await repay(BUSINESS_LOAN_ID);
    assert.equal(response.statusCode, HTTP_OK, response.body);
    assert.equal(response.json<{ status: string }>().status, "repaid");

    const loanPay = signerOf("LoanPay");
    assert.equal(loanPay?.signer, borrower);
    assert.deepEqual(loanPay?.tx, {
      TransactionType: "LoanPay",
      Account: borrower,
      LoanID: BUSINESS_LOAN_ID,
      Amount: { currency: RLUSD_CURRENCY, issuer: asset.issuer, value: TOTAL_DUE_PAID },
    });

    const payments = sent.flatMap(({ tx, signer }) => (tx.TransactionType === "Payment" ? [[signer, tx.Destination, tx.Amount]] : []));
    assert.deepEqual(payments, [
      [actors.mairie.address, borrower, { currency: RLUSD_CURRENCY, issuer: asset.issuer, value: "10000" }],
      [actors.bari.address, borrower, { mpt_issuance_id: "01".repeat(24), value: "1" }],
    ]);
    assert.ok(sent.every(({ signer }) => signer !== actors.sme.address));
  });

  test("un prêt de la PME de démo, ou sans emprunteur enregistré, reste remboursé par la PME de démo", async () => {
    for (const loanId of [DEMO_LOAN_ID, LEGACY_LOAN_ID]) {
      sent.length = 0;
      const response = await repay(loanId);
      assert.equal(response.statusCode, HTTP_OK, response.body);
      assert.equal(signerOf("LoanPay")?.signer, actors.sme.address);
    }
  });

  test("un emprunteur sans compte géré connu de Bari est refusé sans transaction", async () => {
    const response = await repay(ORPHAN_LOAN_ID);
    assert.equal(response.statusCode, HTTP_CONFLICT);
    assert.deepEqual(sent, []);
  });
});

describe("POST /api/loans/:id/repay pour une entreprise connectée par son wallet", () => {
  const submitRepayment = (txBlob: string) =>
    app.inject({ method: "POST", url: `/api/loans/${WALLET_LOAN_ID}/repay/submit`, payload: { tx_blob: txBlob } });
  const signed = (tx: Record<string, unknown>) => walletBorrower.sign(tx as unknown as Transaction).tx_blob;
  const cityPayments = () =>
    sent.filter(({ tx, signer }) => tx.TransactionType === "Payment" && signer === actors.mairie.address && tx.Destination === walletBorrower.address);
  let prepared: PreparedSignature | undefined;

  test("la mairie paie l'entreprise, puis Bari prépare son LoanPay à signer dans Otsu, sans rien signer pour elle", async () => {
    const response = await repay(WALLET_LOAN_ID);
    assert.equal(response.statusCode, HTTP_OK, response.body);
    prepared = response.json<PreparedSignature>();
    assert.equal(prepared.status, "sign");
    assert.deepEqual(prepared.tx, {
      TransactionType: "LoanPay",
      Account: walletBorrower.address,
      LoanID: WALLET_LOAN_ID,
      Amount: { currency: RLUSD_CURRENCY, issuer: asset.issuer, value: TOTAL_DUE_PAID },
      Sequence: WALLET_SEQUENCE,
      LastLedgerSequence: LEDGER_INDEX + SIGNING_WINDOW_LEDGERS,
      Fee: "12",
    });
    assert.equal(cityPayments().length, 1);
    assert.equal(signerOf("LoanPay"), undefined);
    assert.equal(context.store.current?.loans.find(({ loanId }) => loanId === WALLET_LOAN_ID)?.status, "active");
  });

  test("redemandé : la mairie ne paie pas deux fois", async () => {
    const response = await repay(WALLET_LOAN_ID);
    assert.equal(response.statusCode, HTTP_OK, response.body);
    prepared = response.json<PreparedSignature>();
    assert.equal(cityPayments().length, 0);
  });

  test("un LoanPay modifié est refusé en 400, sans soumission", async () => {
    assert.ok(prepared !== undefined);
    const response = await submitRepayment(signed({ ...prepared.tx, Amount: { currency: RLUSD_CURRENCY, issuer: asset.issuer, value: "1" } }));
    assert.equal(response.statusCode, HTTP_BAD_REQUEST);
    assert.deepEqual(walletSubmitted, []);
  });

  test("le LoanPay signé tel quel est soumis, puis Bari rend le MPT facture et le prêt est remboursé", async () => {
    assert.ok(prepared !== undefined);
    const txBlob = signed(prepared.tx);
    const response = await submitRepayment(txBlob);
    assert.equal(response.statusCode, HTTP_OK, response.body);
    assert.equal(response.json<{ status: string }>().status, "repaid");
    assert.deepEqual(walletSubmitted, [txBlob]);
    assert.equal(decode(txBlob).Account, walletBorrower.address);
    const returned = sent.find(({ tx }) => tx.TransactionType === "Payment" && tx.Account === actors.bari.address);
    assert.deepEqual(returned?.tx.TransactionType === "Payment" ? [returned.tx.Destination, returned.tx.Amount] : [], [
      walletBorrower.address,
      { mpt_issuance_id: "05".repeat(24), value: "1" },
    ]);
    assert.equal(context.store.current?.loans.find(({ loanId }) => loanId === WALLET_LOAN_ID)?.status, "repaid");
  });
});
