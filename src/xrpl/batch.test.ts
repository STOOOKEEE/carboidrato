// Batch tfAllOrNothing à faire signer par un wallet : transactions internes marquées, séquences laissées à l'autofill.

import assert from "node:assert/strict";
import { test } from "node:test";
import { BatchFlags, GlobalFlags, Wallet, type Payment } from "xrpl";
import { allOrNothingBatch } from "./batch.js";

test("compte externe = signataire final, transactions internes en tfInnerBatchTxn, sans séquence", () => {
  const user = Wallet.generate().address;
  const bari = Wallet.generate().address;
  const toBari: Payment = { TransactionType: "Payment", Account: user, Destination: bari, Amount: "1" };
  const toUser: Payment = { TransactionType: "Payment", Account: bari, Destination: user, Amount: "2", Flags: 0 };
  assert.deepEqual(allOrNothingBatch(user, [toBari, toUser]), {
    TransactionType: "Batch",
    Account: user,
    Flags: BatchFlags.tfAllOrNothing,
    RawTransactions: [
      { RawTransaction: { ...toBari, Flags: GlobalFlags.tfInnerBatchTxn } },
      { RawTransaction: { ...toUser, Flags: GlobalFlags.tfInnerBatchTxn } },
    ],
  });
});

test("Flags non numériques refusés", () => {
  const tx = { TransactionType: "Payment", Account: "r", Destination: "r", Amount: "1", Flags: { tfPartialPayment: true } } as const;
  assert.throws(() => allOrNothingBatch("r", [tx]), /Flags numériques/);
});
