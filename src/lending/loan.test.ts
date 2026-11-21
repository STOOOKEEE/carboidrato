// LoanSet construit pour un Vault en RLUSD : principal et frais de dossier en valeur décimale du ledger ; LoanSet
// préparé pour le wallet de l'emprunteur, puis co-signé par Bari tel que le wallet l'a signé.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { decode, hashes, Wallet } from "xrpl";
import type { Fund } from "../fund/fund.js";
import { encodeLoanData } from "../fund/loanData.js";
import { usdToUnits } from "../lib/amounts.js";
import { FakeLedger } from "../xrpl/fakeLedger.js";
import { SIGNING_WINDOW_LEDGERS, type WalletTxPorts } from "../xrpl/preparedTx.js";
import { RLUSD_CURRENCY } from "../xrpl/stablecoin.js";
import type { TxOutcome } from "../xrpl/submit.js";
import { counterSignLoan, loanSetTransaction, prepareLoanSet, type LoanProposal } from "./loan.js";
import { loanTerms } from "./loanTerms.js";

const BROKER_ID = "44".repeat(32);
const REFERENCE = { nullifier: "AA".repeat(32), invoiceTokenId: "BB".repeat(24), pseudonym: "CC".repeat(32) };

describe("loanSetTransaction", () => {
  test("palier de 10 000 $ : principal 9000 RLUSD, frais 45 RLUSD, échéance unique", () => {
    const borrower = Wallet.generate().address;
    const tx = loanSetTransaction(borrower, BROKER_ID, loanTerms(usdToUnits(10_000)), REFERENCE, 600);
    assert.equal(tx.TransactionType, "LoanSet");
    assert.equal(tx.Account, borrower);
    assert.equal(tx.LoanBrokerID, BROKER_ID);
    assert.equal(tx.PrincipalRequested, "9000");
    assert.equal(tx.LoanOriginationFee, "45");
    assert.equal(tx.PaymentTotal, 1);
    assert.equal(tx.PaymentInterval, 600);
    assert.equal(tx.Data, encodeLoanData(REFERENCE));
  });

  test("palier de 20 000 $ : principal 18000 RLUSD, frais 90 RLUSD", () => {
    const tx = loanSetTransaction(Wallet.generate().address, BROKER_ID, loanTerms(usdToUnits(23_450)), REFERENCE, 600);
    assert.deepEqual([tx.PrincipalRequested, tx.LoanOriginationFee], ["18000", "90"]);
  });
});

const STABLECOIN = { currency: RLUSD_CURRENCY, issuer: Wallet.generate().address };
const FUND = { stablecoin: STABLECOIN, brokerId: BROKER_ID } as Fund;
const LOAN_ID = "4C".repeat(32);

function proposal(borrower: string): LoanProposal {
  const terms = loanTerms(usdToUnits(10_000));
  const loanSet = loanSetTransaction(borrower, BROKER_ID, terms, REFERENCE, 600);
  return { loanSet, reference: REFERENCE, checks: [], terms, interval: 600, maturity: 1_600 };
}

describe("prepareLoanSet", () => {
  test("LoanSet complet pour le wallet : séquence, échéance ≈ 5 min, frais de l'autofill, aucune signature", async () => {
    const borrower = Wallet.generate().address;
    const ports: WalletTxPorts = {
      accountState: async (account) => {
        assert.equal(account, borrower);
        return { sequence: 12, ledgerIndex: 900 };
      },
      autofill: async (tx) => ({ ...tx, Fee: "24" }),
      submitSigned: async () => assert.fail("rien n'est soumis à la préparation"),
    };
    const loanSet = await prepareLoanSet(ports, proposal(borrower));
    assert.deepEqual(loanSet, { ...proposal(borrower).loanSet, Sequence: 12, LastLedgerSequence: 900 + SIGNING_WINDOW_LEDGERS, Fee: "24" });
  });
});

describe("counterSignLoan", () => {
  test("Bari co-signe le blob de l'emprunteur tel quel, le soumet, et vérifie l'avance reçue", async () => {
    const borrower = Wallet.generate();
    const bari = Wallet.generate();
    const offer = proposal(borrower.address);
    const prepared = { ...offer.loanSet, Sequence: 12, LastLedgerSequence: 1_000, Fee: "24" };
    const borrowerBlob = borrower.sign(prepared).tx_blob;
    const ledger = new FakeLedger(1000);
    const submitted: string[] = [];
    const ports = {
      submitSigned: async (txBlob: string, hash: string): Promise<TxOutcome> => {
        submitted.push(txBlob);
        ledger.putStablecoinBalance(STABLECOIN, borrower.address, offer.terms.netAdvance);
        const meta = { TransactionResult: "tesSUCCESS", TransactionIndex: 0, AffectedNodes: [{ CreatedNode: { LedgerEntryType: "Loan", LedgerIndex: LOAN_ID, NewFields: {} } }] };
        return { hash, result: "tesSUCCESS", meta } as TxOutcome;
      },
    };

    const loan = await counterSignLoan(ports, ledger, bari, FUND, offer, borrowerBlob);
    assert.equal(loan.loanId, LOAN_ID);
    assert.equal(submitted.length, 1);
    const sent = decode(submitted[0]);
    assert.equal(sent.TxnSignature, decode(borrowerBlob).TxnSignature);
    assert.equal((sent.CounterpartySignature as { SigningPubKey: string }).SigningPubKey, bari.publicKey);
    assert.equal(loan.hash, hashes.hashSignedTx(submitted[0]));
  });

  test("avance reçue différente : erreur", async () => {
    const borrower = Wallet.generate();
    const offer = proposal(borrower.address);
    const borrowerBlob = borrower.sign({ ...offer.loanSet, Sequence: 12, LastLedgerSequence: 1_000, Fee: "24" }).tx_blob;
    const ports = {
      submitSigned: async (_txBlob: string, hash: string): Promise<TxOutcome> => {
        const meta = { TransactionResult: "tesSUCCESS", TransactionIndex: 0, AffectedNodes: [{ CreatedNode: { LedgerEntryType: "Loan", LedgerIndex: LOAN_ID, NewFields: {} } }] };
        return { hash, result: "tesSUCCESS", meta } as TxOutcome;
      },
    };
    await assert.rejects(counterSignLoan(ports, new FakeLedger(1000), Wallet.generate(), FUND, offer, borrowerBlob), /au lieu de/);
  });
});
