// Transaction préparée puis signée dans un wallet : seule la même transaction, bien signée, est reconnue.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BatchFlags, decode, encode, GlobalFlags, Wallet, type Batch, type Transaction, type TrustSet } from "xrpl";
import { matchesPrepared, PreparedStore } from "./preparedTx.js";

const wallet = Wallet.generate();
const trustSet: TrustSet = {
  TransactionType: "TrustSet",
  Account: wallet.address,
  LimitAmount: { currency: "USD", issuer: Wallet.generate().address, value: "1000" },
  Fee: "12",
  Sequence: 7,
  LastLedgerSequence: 1_000,
};

const sign = (tx: Transaction, signer: Wallet = wallet) => signer.sign(tx).tx_blob;

describe("matchesPrepared", () => {
  test("la transaction préparée, signée telle quelle → vrai", () => {
    assert.equal(matchesPrepared(trustSet, sign(trustSet)), true);
  });

  test("un champ changé, une signature abîmée ou un blob illisible → faux", () => {
    assert.equal(matchesPrepared(trustSet, sign({ ...trustSet, Fee: "13" })), false);
    const genuine = decode(sign(trustSet));
    const signature = String(genuine.TxnSignature);
    const forged = encode({
      ...(genuine as unknown as Transaction),
      TxnSignature: `${signature.slice(0, -2)}${signature.endsWith("00") ? "01" : "00"}`,
    });
    assert.equal(matchesPrepared(trustSet, forged), false);
    assert.equal(matchesPrepared(trustSet, "00"), false);
  });

  test("Batch : les BatchSigners font partie de la comparaison", () => {
    const inner = { ...trustSet, Flags: GlobalFlags.tfInnerBatchTxn, Fee: "0", SigningPubKey: "", Sequence: 8 };
    const { LastLedgerSequence: _last, ...innerTx } = inner;
    const batch: Batch = {
      TransactionType: "Batch",
      Account: wallet.address,
      Flags: BatchFlags.tfAllOrNothing,
      Fee: "40",
      Sequence: 7,
      LastLedgerSequence: 1_000,
      RawTransactions: [{ RawTransaction: innerTx }, { RawTransaction: { ...innerTx, Sequence: 9 } }],
    };
    assert.equal(matchesPrepared(batch, sign(batch)), true);
    const cosigned: Batch = {
      ...batch,
      BatchSigners: [{ BatchSigner: { Account: Wallet.generate().address, SigningPubKey: "", TxnSignature: "00" } }],
    };
    assert.equal(matchesPrepared(batch, sign(cosigned)), false);
  });
});

test("PreparedStore : la dernière transaction de chaque utilisateur, oubliée sur demande", () => {
  const store = new PreparedStore<string>();
  store.set("a", "first");
  store.set("a", "second");
  store.set("b", "other");
  assert.equal(store.get("a"), "second");
  store.delete("a");
  assert.equal(store.get("a"), undefined);
  assert.equal(store.get("b"), "other");
});
