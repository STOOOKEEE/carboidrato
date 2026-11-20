// Prêts d'un broker relus depuis le ledger seul : objets Loan du pseudo-compte du broker, puis transaction
// LoanSet d'origine (le Loan ne stocke ni Data ni le principal initial). Celle-ci se retrouve en remontant la
// chaîne PreviousTxnID du Loan jusqu'à la transaction qui l'a créé.

import type { Client, LedgerEntry, TransactionMetadata } from "xrpl";
import { decodeLoanData, type LoanReference } from "../lending/loanData.js";
import { parseUnits } from "../lib/amounts.js";
import { getLoanBroker, listAccountObjects } from "../xrpl/ledgerEntries.js";

/** Garde-fou : un prêt Bari ne subit que quelques transactions (LoanSet, LoanPay, LoanManage). */
const MAX_HISTORY_STEPS = 64;

export interface LoanRecord {
  loanId: string;
  loan: LedgerEntry.Loan;
  loanSetHash: string;
  /** Principal initial (PrincipalRequested du LoanSet). */
  principal: bigint;
  /** Principal restant dû (0 si remboursé). */
  outstanding: bigint;
  /** Référence au certificat, ou erreur de décodage du Data. */
  reference: LoanReference | Error;
}

interface LoanCreation {
  hash: string;
  principal: bigint;
  data: string | undefined;
}

/** Ce qu'une transaction a fait au Loan : le créer, ou le modifier après la transaction `previous`. */
type LoanHistoryStep = { created: true } | { created: false; previous: string };

function loanHistoryStep(meta: TransactionMetadata, loanId: string): LoanHistoryStep {
  for (const node of meta.AffectedNodes) {
    if ("CreatedNode" in node && node.CreatedNode.LedgerIndex === loanId) return { created: true };
    if ("ModifiedNode" in node && node.ModifiedNode.LedgerIndex === loanId) {
      const previous = node.ModifiedNode.PreviousTxnID;
      if (previous !== undefined) return { created: false, previous };
    }
  }
  throw new Error(`Historique du prêt ${loanId} interrompu`);
}

/** Remonte PreviousTxnID jusqu'à la transaction qui a créé le Loan. */
async function findLoanCreation(client: Client, loanId: string, lastTxHash: string): Promise<LoanCreation> {
  let hash = lastTxHash;
  for (let count = 0; count < MAX_HISTORY_STEPS; count++) {
    const { result } = await client.request({ command: "tx", transaction: hash });
    if (result.meta === undefined || typeof result.meta === "string") throw new Error(`Métadonnées absentes : ${hash}`);
    const step = loanHistoryStep(result.meta, loanId);
    if (step.created) {
      const tx = result.tx_json;
      if (tx.TransactionType !== "LoanSet") throw new Error(`Prêt ${loanId} créé par ${tx.TransactionType}`);
      return { hash, principal: parseUnits(tx.PrincipalRequested), data: tx.Data };
    }
    hash = step.previous;
  }
  throw new Error(`Création du prêt ${loanId} introuvable en ${MAX_HISTORY_STEPS} étapes`);
}

function decodeReference(data: string | undefined): LoanReference | Error {
  try {
    return decodeLoanData(data);
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

export async function listLoanRecords(client: Client, brokerId: string): Promise<LoanRecord[]> {
  const broker = await getLoanBroker(client, brokerId);
  const loans = (await listAccountObjects(client, broker.Account, "loan")).filter(
    (entry): entry is LedgerEntry.Loan => entry.LedgerEntryType === "Loan" && entry.LoanBrokerID === brokerId,
  );
  const records: LoanRecord[] = [];
  for (const loan of loans) {
    const creation = await findLoanCreation(client, loan.index, loan.PreviousTxnID);
    records.push({
      loanId: loan.index,
      loan,
      loanSetHash: creation.hash,
      principal: creation.principal,
      outstanding: parseUnits(loan.PrincipalOutstanding),
      reference: decodeReference(creation.data),
    });
  }
  return records.sort((a, b) => a.loan.LoanSequence - b.loan.LoanSequence);
}
