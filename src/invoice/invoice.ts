// Facture de la PME à la mairie (données hors chaîne : elles ne quittent jamais la PME et le débiteur).

import { INVOICE_AMOUNT_USD, INVOICE_TERM_DAYS } from "../config/finance.js";
import type { VerifiedDebtor } from "./debtors.js";

export interface Invoice {
  debtor: VerifiedDebtor;
  /** Numéro officiel attribué à la facture (base de l'uuid HMAC du débiteur). */
  number: string;
  issueDate: Date;
  dueDate: Date;
  amountUsd: number;
}

const MS_PER_DAY = 86_400_000;

/**
 * Facture simulée. Le numéro dépend de l'exécution pour que le premier enregistrement réussisse
 * même avec des comptes réutilisés ; dans une même exécution, le rejeu reste un doublon.
 */
export function buildDemoInvoice(debtor: VerifiedDebtor, runId: string, index: number): Invoice {
  const issueDate = new Date();
  return {
    debtor,
    number: `FT-2026/${runId}-${index}`,
    issueDate,
    dueDate: new Date(issueDate.getTime() + INVOICE_TERM_DAYS * MS_PER_DAY),
    amountUsd: INVOICE_AMOUNT_USD,
  };
}

/** Forme canonique du numéro : deux saisies de la même facture donnent le même uuid. */
export function normalizeInvoiceNumber(invoice: Invoice): string {
  return invoice.number.trim().toUpperCase().replace(/\s+/g, "");
}
