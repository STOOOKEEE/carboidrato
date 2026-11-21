// État du fonds courant, gardé en mémoire et persisté dans un fichier gitignoré pour survivre à un redémarrage.
// Le ledger reste la source de vérité : ce fichier ne garde que les identifiants nécessaires pour le retrouver.

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { rippleTimeToISOTime } from "xrpl";
import type { Fund } from "../../fund/fund.js";
import type { LoanReference } from "../../fund/loanData.js";
import type { InvoiceCertificate } from "../../invoice/certificate.js";
import type { OriginatedLoan } from "../../lending/loan.js";

export type LoanStatus = "active" | "repaid" | "defaulted";

/** Les champs optionnels manquent dans les états écrits avant les comptes utilisateurs. */
export interface InvoiceRecord {
  tokenId: string;
  certificate: InvoiceCertificate;
  issuedAt: string;
  /** Compte XRPL de l'entreprise qui a émis le MPT facture. */
  owner?: string;
  /** Hash du Batch du certificat. */
  txHash?: string;
}

export interface LoanState {
  loanId: string;
  reference: LoanReference;
  status: LoanStatus;
  createdAt: string;
  /** Compte XRPL de l'entreprise emprunteuse. */
  borrower?: string;
  /** Hash du LoanSet. */
  txHash?: string;
  /** Principal et frais de dossier, en unités EURc (chaîne décimale : l'état est du JSON). */
  principal?: string;
  originationFee?: string;
  /** Échéance du prêt (ISO). */
  dueDate?: string;
}

/** Prêt co-signé tel que persisté : les montants bigint deviennent des chaînes. */
export function loanState(loan: OriginatedLoan, borrower: string, status: LoanStatus, createdAt: string): LoanState {
  return {
    loanId: loan.loanId,
    reference: loan.reference,
    status,
    createdAt,
    borrower,
    txHash: loan.hash,
    principal: loan.terms.principal.toString(),
    originationFee: loan.terms.originationFee.toString(),
    dueDate: rippleTimeToISOTime(loan.maturity),
  };
}

export interface FundState {
  fund: Fund;
  createdAt: string;
  deposited: boolean;
  redeemed: boolean;
  invoices: InvoiceRecord[];
  loans: LoanState[];
}

function isFundState(value: unknown): value is FundState {
  if (typeof value !== "object" || value === null) return false;
  const { fund, invoices, loans } = value as Record<string, unknown>;
  if (typeof fund !== "object" || fund === null) return false;
  const { cohort, brokerId, assetId } = fund as Record<string, unknown>;
  return (
    typeof cohort === "object" &&
    cohort !== null &&
    typeof (cohort as Record<string, unknown>).vaultId === "string" &&
    typeof brokerId === "string" &&
    typeof assetId === "string" &&
    Array.isArray(invoices) &&
    Array.isArray(loans)
  );
}

export class FundStateStore {
  private state: FundState | undefined;

  constructor(private readonly file: string) {
    this.state = this.load();
  }

  get current(): FundState | undefined {
    return this.state;
  }

  /** Remplace le fonds courant (nouvelle cohorte). */
  reset(fund: Fund): FundState {
    this.state = { fund, createdAt: new Date().toISOString(), deposited: false, redeemed: false, invoices: [], loans: [] };
    this.save();
    return this.state;
  }

  /** Applique une modification à l'état courant puis le persiste. */
  update(change: (state: FundState) => void): void {
    if (this.state === undefined) throw new Error("Aucun fonds courant");
    change(this.state);
    this.save();
  }

  private load(): FundState | undefined {
    if (!existsSync(this.file)) return undefined;
    const parsed: unknown = JSON.parse(readFileSync(this.file, "utf8"));
    if (!isFundState(parsed)) throw new Error(`Format inattendu dans ${this.file} : supprimer le fichier pour repartir de zéro`);
    return parsed;
  }

  /** Écriture atomique (fichier temporaire puis renommage) : un arrêt brutal ne laisse pas un état tronqué. */
  private save(): void {
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(this.state, null, 2)}\n`);
    renameSync(temporary, this.file);
  }
}
