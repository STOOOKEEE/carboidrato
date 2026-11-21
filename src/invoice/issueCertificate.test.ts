// Batch du certificat préparé pour le wallet de l'entreprise : séquences, co-signature de Bari dans BatchSigners,
// compte externe = l'entreprise ; puis lecture de son application, sans réseau.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  encodeForSigningBatch,
  GlobalFlags,
  hashes,
  verifyKeypairSignature,
  Wallet,
  type Batch,
  type SubmittableTransaction,
  type TransactionMetadata,
} from "xrpl";
import { FakeLedger } from "../xrpl/fakeLedger.js";
import type { LedgerTransaction } from "../xrpl/ledger.js";
import { SIGNING_WINDOW_LEDGERS, type WalletTxPorts } from "../xrpl/preparedTx.js";
import type { InvoiceCertificate } from "./certificate.js";
import { invoiceTokenId } from "./invoiceToken.js";
import { prepareCertificateBatch, settleCertificateBatch } from "./issueCertificate.js";

const SME_SEQUENCE = 50;
const BARI_SEQUENCE = 7;
const LEDGER_INDEX = 900;
const FEE = "48";
const NULLIFIER = "AB".repeat(32);

const sme = Wallet.generate();
const bari = Wallet.generate();
const registry = Wallet.generate().address;
const certificate = { nullifier: NULLIFIER, pseudonym: "CD".repeat(32), commitment: "EF".repeat(32), metadataHex: "00" } as InvoiceCertificate;

/** Faux nœud : séquences par compte ; autofill complète comme xrpl.js (frais, transactions internes). */
function fakePorts(signersCounts: (number | undefined)[]): WalletTxPorts {
  return {
    accountState: async (account) => ({ sequence: account === sme.address ? SME_SEQUENCE : BARI_SEQUENCE, ledgerIndex: LEDGER_INDEX }),
    autofill: async <T extends SubmittableTransaction>(tx: T, signersCount?: number) => {
      signersCounts.push(signersCount);
      if (tx.TransactionType !== "Batch") return { ...tx, Fee: FEE };
      const batch = tx as unknown as Batch;
      const RawTransactions = batch.RawTransactions.map(({ RawTransaction }) => ({
        RawTransaction: { ...RawTransaction, Fee: "0", SigningPubKey: "" },
      }));
      return { ...tx, Fee: FEE, RawTransactions } as T;
    },
    submitSigned: async () => {
      throw new Error("aucune soumission pendant la préparation");
    },
  };
}

describe("prepareCertificateBatch", () => {
  test("Batch de l'entreprise, complété, co-signé par Bari seul dans BatchSigners ; l'entreprise signera le Batch externe", async () => {
    const signersCounts: (number | undefined)[] = [];
    const prepared = await prepareCertificateBatch(fakePorts(signersCounts), { sme: sme.address, bari, registry }, certificate);
    const { batch } = prepared;

    assert.equal(batch.Account, sme.address);
    assert.equal(batch.Sequence, SME_SEQUENCE);
    assert.equal(batch.LastLedgerSequence, LEDGER_INDEX + SIGNING_WINDOW_LEDGERS);
    assert.equal(batch.Fee, FEE);
    assert.equal(batch.TxnSignature, undefined);
    assert.deepEqual(signersCounts, [1]);

    const inner = batch.RawTransactions.map(({ RawTransaction }) => RawTransaction);
    assert.deepEqual(
      inner.map(({ TransactionType, Account, Sequence }) => [TransactionType, Account, Sequence]),
      [
        ["CredentialCreate", sme.address, SME_SEQUENCE + 1],
        ["MPTokenIssuanceCreate", sme.address, SME_SEQUENCE + 2],
        ["MPTokenAuthorize", bari.address, BARI_SEQUENCE],
        ["Payment", sme.address, SME_SEQUENCE + 3],
      ],
    );
    assert.ok(inner.every((tx) => ((tx.Flags as number) & GlobalFlags.tfInnerBatchTxn) !== 0));
    assert.equal(prepared.tokenId, invoiceTokenId(sme.address, SME_SEQUENCE + 2));
    assert.deepEqual(
      prepared.innerHashes,
      inner.map((tx) => hashes.hashSignedTx(tx)),
    );

    const signers = batch.BatchSigners ?? [];
    assert.equal(signers.length, 1);
    const [{ BatchSigner }] = signers;
    assert.equal(BatchSigner.Account, bari.address);
    assert.equal(BatchSigner.SigningPubKey, bari.publicKey);
    // La signature de Bari lie le compte et la séquence du Batch externe : Otsu ne peut rien en changer.
    const signed = encodeForSigningBatch({
      account: sme.address,
      sequence: SME_SEQUENCE,
      flags: batch.Flags,
      txIDs: prepared.innerHashes,
      batchAccount: bari.address,
    } as never);
    assert.ok(verifyKeypairSignature(signed, BatchSigner.TxnSignature ?? "", bari.publicKey));
  });
});

describe("settleCertificateBatch", () => {
  const prepare = () => prepareCertificateBatch(fakePorts([]), { sme: sme.address, bari, registry }, certificate);
  const outcome = { hash: "BA".repeat(32), result: "tesSUCCESS", meta: {} as TransactionMetadata };

  function validate(ledger: FakeLedger, innerHashes: string[], tokenId: string): void {
    innerHashes.forEach((hash, index) => {
      const meta = { TransactionResult: "tesSUCCESS", AffectedNodes: [], ...(index === 1 ? { mpt_issuance_id: tokenId } : {}) };
      ledger.putTransaction({ hash, validated: true, meta } as unknown as LedgerTransaction);
    });
  }

  test("toutes les transactions internes appliquées : le MPT facture calculé d'avance est émis", async () => {
    const prepared = await prepare();
    const ledger = new FakeLedger(1000);
    validate(ledger, prepared.innerHashes, prepared.tokenId);
    const issued = await settleCertificateBatch(ledger, prepared, outcome, certificate);
    assert.deepEqual(issued, { certificate, tokenId: prepared.tokenId });
  });

  test("aucune transaction interne appliquée (N déjà enregistré) : undefined", async () => {
    const prepared = await prepare();
    assert.equal(await settleCertificateBatch(new FakeLedger(1000), prepared, outcome, certificate), undefined);
  });
});
