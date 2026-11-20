// Extraction des objets créés par une transaction, depuis ses métadonnées.

import type { TransactionMetadata } from "xrpl";

/** Identifiant (LedgerIndex) de l'objet du type donné créé par la transaction. */
export function createdLedgerIndex(meta: TransactionMetadata, ledgerEntryType: string): string {
  for (const node of meta.AffectedNodes) {
    if ("CreatedNode" in node && node.CreatedNode.LedgerEntryType === ledgerEntryType) {
      return node.CreatedNode.LedgerIndex;
    }
  }
  throw new Error(`Aucun objet ${ledgerEntryType} créé par la transaction`);
}

export function createdMptIssuanceId(meta: TransactionMetadata): string {
  if ("mpt_issuance_id" in meta && typeof meta.mpt_issuance_id === "string") {
    return meta.mpt_issuance_id;
  }
  throw new Error("mpt_issuance_id absent des métadonnées");
}
