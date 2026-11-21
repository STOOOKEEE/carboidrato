// LoanSet construit pour un Vault en RLUSD : principal et frais de dossier en valeur décimale du ledger.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Wallet } from "xrpl";
import { encodeLoanData } from "../fund/loanData.js";
import { eurToUnits } from "../lib/amounts.js";
import { loanSetTransaction } from "./loan.js";
import { loanTerms } from "./loanTerms.js";

const BROKER_ID = "44".repeat(32);
const REFERENCE = { nullifier: "AA".repeat(32), invoiceTokenId: "BB".repeat(24), pseudonym: "CC".repeat(32) };

describe("loanSetTransaction", () => {
  test("palier de 10 000 € : principal 9000 RLUSD, frais 45 RLUSD, échéance unique", () => {
    const borrower = Wallet.generate().address;
    const tx = loanSetTransaction(borrower, BROKER_ID, loanTerms(eurToUnits(10_000)), REFERENCE, 600);
    assert.equal(tx.TransactionType, "LoanSet");
    assert.equal(tx.Account, borrower);
    assert.equal(tx.LoanBrokerID, BROKER_ID);
    assert.equal(tx.PrincipalRequested, "9000");
    assert.equal(tx.LoanOriginationFee, "45");
    assert.equal(tx.PaymentTotal, 1);
    assert.equal(tx.PaymentInterval, 600);
    assert.equal(tx.Data, encodeLoanData(REFERENCE));
  });

  test("palier de 20 000 € : principal 18000 RLUSD, frais 90 RLUSD", () => {
    const tx = loanSetTransaction(Wallet.generate().address, BROKER_ID, loanTerms(eurToUnits(23_450)), REFERENCE, 600);
    assert.deepEqual([tx.PrincipalRequested, tx.LoanOriginationFee], ["18000", "90"]);
  });
});
