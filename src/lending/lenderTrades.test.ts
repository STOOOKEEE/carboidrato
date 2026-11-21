// Ordres d'un prêteur : VaultDeposit / VaultWithdraw natifs, ou Batch de deux Payment avec Bari (faux soumetteurs).

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Wallet, type SubmittableTransaction } from "xrpl";
import type { Fund } from "../fund/fund.js";
import type { PendingInner, SubmitBatch } from "../xrpl/batch.js";
import type { SubmitTx, TxOutcome } from "../xrpl/submit.js";
import { buySharesFromBari, depositToVault, sellSharesToBari, withdrawFromVault } from "./lenderTrades.js";

const ASSET_ID = "00".repeat(24);
const SHARE_ID = "11".repeat(24);
const VAULT_ID = "22".repeat(32);
const HASH = "AA".repeat(32);

const fund = {
  assetId: ASSET_ID,
  domainId: "33".repeat(32),
  brokerId: "44".repeat(32),
  cohort: { vaultId: VAULT_ID, shareMptId: SHARE_ID, subscriptionDate: 100, redemptionDate: 200 },
  manifest: { debtorsRoot: "55".repeat(32), vintage: 2026, registry: Wallet.generate().address },
} satisfies Fund;
const bari = Wallet.generate();
const lender = Wallet.generate();
const outcome: TxOutcome = { hash: HASH, result: "tesSUCCESS", meta: { AffectedNodes: [], TransactionIndex: 0, TransactionResult: "tesSUCCESS" } };

function recordingSubmit(): { submit: SubmitTx; sent: { tx: SubmittableTransaction; signer: string }[] } {
  const sent: { tx: SubmittableTransaction; signer: string }[] = [];
  return {
    sent,
    submit: async (tx, wallet) => {
      sent.push({ tx, signer: wallet.address });
      return outcome;
    },
  };
}

function recordingBatch(): { submitBatch: SubmitBatch; batches: { submitter: string; cosigner: string; inner: readonly PendingInner[] }[] } {
  const batches: { submitter: string; cosigner: string; inner: readonly PendingInner[] }[] = [];
  return {
    batches,
    submitBatch: async (submitter, cosigner, inner) => {
      batches.push({ submitter: submitter.address, cosigner: cosigner.address, inner });
      return outcome;
    },
  };
}

describe("chemin natif", () => {
  test("VaultDeposit d'EURc signé par le compte géré du prêteur", async () => {
    const { submit, sent } = recordingSubmit();
    assert.equal(await depositToVault(submit, fund, lender, 5_000_000n), outcome);
    assert.deepEqual(sent, [
      {
        signer: lender.address,
        tx: {
          TransactionType: "VaultDeposit",
          Account: lender.address,
          VaultID: VAULT_ID,
          Amount: { mpt_issuance_id: ASSET_ID, value: "5000000" },
        },
      },
    ]);
  });

  test("VaultWithdraw d'un nombre de parts", async () => {
    const { submit, sent } = recordingSubmit();
    await withdrawFromVault(submit, fund, lender, 7n);
    assert.deepEqual(sent[0]?.tx, {
      TransactionType: "VaultWithdraw",
      Account: lender.address,
      VaultID: VAULT_ID,
      Amount: { mpt_issuance_id: SHARE_ID, value: "7" },
    });
  });
});

describe("chemin immédiat : Batch atomique co-signé", () => {
  test("entrée : EURc du prêteur → Bari, parts de Bari → prêteur", async () => {
    const { submitBatch, batches } = recordingBatch();
    await buySharesFromBari(submitBatch, { fund, bari, lender }, { amount: 1_020n, shares: 1_000n });
    assert.equal(batches.length, 1);
    const [batch] = batches;
    assert.equal(batch.submitter, bari.address);
    assert.equal(batch.cosigner, lender.address);
    assert.deepEqual(
      batch.inner.map(({ tx }) => tx),
      [
        { TransactionType: "Payment", Account: lender.address, Destination: bari.address, Amount: { mpt_issuance_id: ASSET_ID, value: "1020" } },
        { TransactionType: "Payment", Account: bari.address, Destination: lender.address, Amount: { mpt_issuance_id: SHARE_ID, value: "1000" } },
      ],
    );
  });

  test("sortie : parts du prêteur → Bari, EURc de Bari → prêteur", async () => {
    const { submitBatch, batches } = recordingBatch();
    await sellSharesToBari(submitBatch, { fund, bari, lender }, { amount: 1_014n, shares: 1_000n });
    assert.deepEqual(
      batches[0]?.inner.map(({ tx }) => tx),
      [
        { TransactionType: "Payment", Account: lender.address, Destination: bari.address, Amount: { mpt_issuance_id: SHARE_ID, value: "1000" } },
        { TransactionType: "Payment", Account: bari.address, Destination: lender.address, Amount: { mpt_issuance_id: ASSET_ID, value: "1014" } },
      ],
    );
  });
});
