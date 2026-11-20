// Énoncé public d'une preuve : ordre des signaux publics de snarkjs (sorties, puis entrées publiques
// dans l'ordre de déclaration du circuit) et conversions.

import type { Groth16Proof, PublicSignals } from "snarkjs";
import { toHex32 } from "./field.js";

/** Ordre exact du tableau publicSignals produit par le circuit bari_invoice. */
export const PUBLIC_SIGNAL_ORDER = [
  "commitment",
  "nullifier",
  "pseudonym",
  "debtorsRoot",
  "account",
  "threshold",
  "dueDate",
  "networkId",
  "registry",
  "vintage",
] as const;

export type PublicSignalName = (typeof PUBLIC_SIGNAL_ORDER)[number];

/** Valeurs publiques d'une preuve, en entiers du corps. */
export type InvoiceStatement = Record<PublicSignalName, bigint>;

/** Preuve Groth16 + signaux publics : ce qui est publié dans le MPT facture. */
export interface InvoiceProof {
  proof: Groth16Proof;
  publicSignals: PublicSignals;
}

/** Sorties destinées au ledger : hex de 32 octets big-endian, en majuscules. */
export interface StatementHex {
  /** N : CredentialType du registre, et Data du LoanSet. */
  nullifier: string;
  /** P : pseudonyme du débiteur dans le millésime. */
  pseudonym: string;
  /** C : engagement sur la facture. */
  commitment: string;
  /** Racine de la liste des débiteurs vérifiés. */
  merkleRoot: string;
}

export function parsePublicSignals(publicSignals: PublicSignals): InvoiceStatement {
  if (publicSignals.length !== PUBLIC_SIGNAL_ORDER.length) {
    throw new Error(`Nombre de signaux publics inattendu : ${publicSignals.length}`);
  }
  const entries = PUBLIC_SIGNAL_ORDER.map((name, index) => [name, BigInt(publicSignals[index])] as const);
  return Object.fromEntries(entries) as InvoiceStatement;
}

export function statementHex(statement: InvoiceStatement): StatementHex {
  return {
    nullifier: toHex32(statement.nullifier),
    pseudonym: toHex32(statement.pseudonym),
    commitment: toHex32(statement.commitment),
    merkleRoot: toHex32(statement.debtorsRoot),
  };
}
