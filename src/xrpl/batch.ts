// Batch XRPL multi-comptes en tfAllOrNothing : le soumetteur signe le Batch externe (et paie tous les frais),
// le co-signataire signe dans BatchSigners. Les transactions internes portent tfInnerBatchTxn, Fee = 0, sans signature.
// Si une transaction interne échoue, le Batch externe est quand même validé (frais prélevés) mais aucune
// transaction interne n'est appliquée : elles sont alors absentes du ledger.

import {
  BatchFlags,
  GlobalFlags,
  hashes,
  signMultiBatch,
  type Batch,
  type Client,
  type SubmittableTransaction,
  type TransactionMetadata,
  type Wallet,
} from "xrpl";
import { log } from "../lib/logger.js";
import { xrplLedger, type Ledger } from "./ledger.js";
import { submitSignedBlob, UnexpectedTxResult, type TxOutcome } from "./submit.js";

const SUCCESS = "tesSUCCESS";
/** Une seule signature dans BatchSigners (le co-signataire) : un surcoût d'une fois les frais de base. */
export const COSIGNER_SIGNATURES = 1;

/** Transaction interne à séquence fixée d'avance (nécessaire pour calculer les identifiants déterministes). */
export type SequencedTransaction = SubmittableTransaction & { Sequence: number };

export interface InnerTransaction {
  tx: SequencedTransaction;
  label: string;
}

export interface BatchSubmission {
  outcome: TxOutcome;
  innerHashes: string[];
}

/** Résultat validé d'une transaction interne, présente dans le ledger. */
export interface InnerOutcome {
  hash: string;
  result: string;
  meta: TransactionMetadata;
}

/** Prochaine séquence d'un compte sur le nœud. */
export type SequenceLookup = (account: string) => Promise<number>;

/**
 * Attribue les séquences d'un Batch : le Batch externe consomme la prochaine séquence du soumetteur,
 * puis chaque transaction interne prend la suivante de son compte, dans l'ordre d'appel.
 */
export class BatchSequencer {
  private readonly nextByAccount = new Map<string, number>();

  private constructor(
    private readonly lookup: SequenceLookup,
    readonly outerSequence: number,
    submitter: string,
  ) {
    this.nextByAccount.set(submitter, outerSequence + 1);
  }

  static async open(client: Client, submitter: string): Promise<BatchSequencer> {
    const lookup: SequenceLookup = (account) => currentSequence(client, account);
    return new BatchSequencer(lookup, await lookup(submitter), submitter);
  }

  /** Séquence du soumetteur déjà lue (`outerSequence`) ; celles des autres comptes par `lookup`. */
  static from(lookup: SequenceLookup, submitter: string, outerSequence: number): BatchSequencer {
    return new BatchSequencer(lookup, outerSequence, submitter);
  }

  async next(account: string): Promise<number> {
    const sequence = this.nextByAccount.get(account) ?? (await this.lookup(account));
    this.nextByAccount.set(account, sequence + 1);
    return sequence;
  }
}

async function currentSequence(client: Client, account: string): Promise<number> {
  const response = await client.request({ command: "account_info", account, ledger_index: "current" });
  return response.result.account_data.Sequence;
}

function asInner<T extends SubmittableTransaction>(tx: T): T {
  if (tx.Flags !== undefined && typeof tx.Flags !== "number") {
    throw new Error(`${tx.TransactionType} interne : Flags numériques attendus`);
  }
  return { ...tx, Flags: (tx.Flags ?? 0) | GlobalFlags.tfInnerBatchTxn };
}

/** Batch tfAllOrNothing de `account` (signataire final, paie les frais) ; séquences et frais restent à l'autofill. */
export function allOrNothingBatch(account: string, inner: readonly SubmittableTransaction[]): Batch {
  return {
    TransactionType: "Batch",
    Account: account,
    Flags: BatchFlags.tfAllOrNothing,
    RawTransactions: inner.map((tx) => ({ RawTransaction: asInner(tx) })),
  };
}

/** Hashes des transactions internes d'un Batch complété : connus avant sa soumission. */
export function innerHashesOf(batch: Batch): string[] {
  return batch.RawTransactions.map(({ RawTransaction }) => hashes.hashSignedTx(RawTransaction));
}

/** Construit, co-signe, signe et soumet le Batch ; lève une erreur si le Batch externe n'est pas tesSUCCESS. */
export async function submitAllOrNothingBatch(
  client: Client,
  submitter: Wallet,
  cosigner: Wallet,
  sequencer: BatchSequencer,
  inner: readonly InnerTransaction[],
  label: string,
): Promise<BatchSubmission> {
  const allowedAccounts = new Set([submitter.address, cosigner.address]);
  for (const { tx } of inner) {
    if (!allowedAccounts.has(tx.Account)) throw new Error(`Compte ${tx.Account} non signataire du Batch`);
  }
  const batch: Batch = { ...allOrNothingBatch(submitter.address, inner.map(({ tx }) => tx)), Sequence: sequencer.outerSequence };
  // autofill complète aussi les transactions internes (Fee "0", SigningPubKey "", NetworkID) et calcule
  // les frais du Batch : 2 × base + frais des transactions internes + base par signature de BatchSigners.
  const prepared = await client.autofill(batch, COSIGNER_SIGNATURES);
  signMultiBatch(cosigner, prepared);
  const { tx_blob, hash } = submitter.sign(prepared);
  const outcome = await submitSignedBlob(client, tx_blob, hash, label);
  return { outcome, innerHashes: innerHashesOf(prepared) };
}

async function findValidatedTx(ledger: Ledger, hash: string): Promise<InnerOutcome | undefined> {
  const found = await ledger.transaction(hash);
  if (found === undefined) return undefined;
  const meta = found.meta;
  if (!found.validated || meta === undefined || typeof meta === "string") {
    throw new Error(`Transaction interne ${hash} présente mais non validée`);
  }
  return { hash, result: meta.TransactionResult, meta };
}

/**
 * Lit les transactions internes d'un Batch tfAllOrNothing déjà validé (elles sont dans le même ledger).
 * Renvoie leurs résultats si toutes ont réussi, undefined si aucune n'a été appliquée ; tout autre cas est incohérent.
 */
export async function readAllOrNothingOutcome(
  ledger: Ledger,
  submission: BatchSubmission,
  inner: readonly InnerTransaction[],
): Promise<InnerOutcome[] | undefined> {
  const found = await Promise.all(submission.innerHashes.map((hash) => findValidatedTx(ledger, hash)));
  found.forEach((entry, index) => {
    log.tx(`  ↳ ${inner[index].label}`, submission.innerHashes[index], entry?.result ?? "absente du ledger");
  });
  const applied = found.filter((entry): entry is InnerOutcome => entry !== undefined);
  if (applied.length === 0) return undefined;
  if (applied.length === found.length && applied.every((entry) => entry.result === SUCCESS)) return applied;
  throw new Error(`Batch ${submission.outcome.hash} : application partielle incohérente avec tfAllOrNothing`);
}

/** Transaction interne avant attribution de sa séquence. */
export interface PendingInner {
  tx: SubmittableTransaction;
  label: string;
}

/** Batch tfAllOrNothing à deux signataires, entièrement appliqué : `clientBatchSubmitter`, ou un faux dans les tests. */
export type SubmitBatch = (
  submitter: Wallet,
  cosigner: Wallet,
  inner: readonly PendingInner[],
  label: string,
) => Promise<TxOutcome>;

/** Séquences attribuées dans l'ordre des transactions internes ; lève `UnexpectedTxResult` si aucune n'est appliquée. */
export function clientBatchSubmitter(client: Client): SubmitBatch {
  return async (submitter, cosigner, pending, label) => {
    const sequencer = await BatchSequencer.open(client, submitter.address);
    const inner: InnerTransaction[] = [];
    for (const { tx, label: innerLabel } of pending) {
      inner.push({ tx: { ...tx, Sequence: await sequencer.next(tx.Account) }, label: innerLabel });
    }
    const submission = await submitAllOrNothingBatch(client, submitter, cosigner, sequencer, inner, label);
    if ((await readAllOrNothingOutcome(xrplLedger(client), submission, inner)) === undefined) {
      throw new UnexpectedTxResult(label, "aucune transaction interne appliquée", submission.outcome.hash);
    }
    return submission.outcome;
  };
}
