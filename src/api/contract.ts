// Contrat entre l'API de pré-contrôle et le front (web/) : types seuls, sans dépendance Node,
// pour être importés tels quels par le navigateur.

export const ATTESTED_INVOICE_FORMAT = "bari.attested-invoice.v1";
/** Extension des fichiers de facture attestée. */
export const ATTESTED_INVOICE_EXTENSION = ".bari.json";

/**
 * Facture attestée, telle que la PME la reçoit de son débiteur. Les entiers du corps sont en décimal,
 * l'uuid en hex 32 octets. Seuls les champs de `attestation` sont signés : `invoice` sert à l'affichage.
 */
export interface AttestedInvoiceFile {
  format: typeof ATTESTED_INVOICE_FORMAT;
  invoice: {
    number: string;
    debtorName: string;
    description: string;
    /** Date d'émission ISO. */
    issueDate: string;
  };
  attestation: {
    /** Adresse XRPL de la PME créancière. */
    account: string;
    amountCents: string;
    /** Échéance en secondes Unix. */
    dueDate: string;
    networkId: number;
    /** Adresse XRPL du registre Bari. */
    registry: string;
    uuid: string;
    debtorPublicKey: { ax: string; ay: string };
    signature: { r8x: string; r8y: string; s: string };
  };
}

/** Débiteur vérifié tel que publié par `GET /api/debtors`, dans l'ordre des feuilles de l'arbre de Merkle. */
export interface PublicDebtor {
  name: string;
  /** Code IPA (identifiant officiel des administrations italiennes). */
  ipaCode: string;
  /** Clé EdDSA BabyJubJub, entiers du corps en décimal. */
  publicKey: { ax: string; ay: string };
}

/** Contrôles, dans l'ordre d'affichage ; le libellé de chacun appartient au front. */
export const CHECK_IDS = ["signature", "debtor", "network", "dueDate", "unique"] as const;
export type CheckId = (typeof CHECK_IDS)[number];

export interface CheckResult {
  id: CheckId;
  ok: boolean;
}

/** Offre de financement, montants en euros arrondis au centime. */
export interface LoanOffer {
  invoiceEur: number;
  advanceRatePercent: number;
  principalEur: number;
  feeEur: number;
  /** Ce que la PME reçoit. */
  netAdvanceEur: number;
  interestEur: number;
  interestRatePercent: number;
  /** Frais + intérêts. */
  totalCostEur: number;
  annualCostPercent: number;
  termDays: number;
  /** Ce que la PME rembourse à l'échéance (principal + intérêts). */
  repaymentEur: number;
}

export type Verdict = "eligible" | "rejected";

export interface PrecheckResponse {
  /** Refusée dès qu'un contrôle échoue ; le KYB, lui, se fait après (dans l'app). */
  verdict: Verdict;
  invoice: {
    number: string;
    debtorName: string;
    amountEur: number;
    /** Échéance ISO. */
    dueDate: string;
  };
  checks: CheckResult[];
  kyb: { account: string; done: boolean };
  /** Empreinte N (hex), publique : c'est elle qu'on cherche dans le registre. */
  nullifier: string;
  offer?: LoanOffer;
}

export interface KybRequest {
  account: string;
  company: string;
  vatNumber: string;
}

export interface KybResponse {
  account: string;
  done: true;
  /** Lien explorer vers le credential KYB_PME. */
  explorerUrl: string;
}

export interface ApiError {
  error: string;
}

/** Certificat de facture relu dans les métadonnées du MPT facture : les signaux publics de la preuve. */
export interface TxCertificate {
  proofSystem: string;
  /** Engagement C, empreinte N, pseudonyme P et racine des débiteurs (hex 32 octets). */
  commitment: string;
  nullifier: string;
  pseudonym: string;
  debtorsRoot: string;
  /** PME prouvée et registre Bari (adresses XRPL). */
  account: string;
  registry: string;
  networkId: number;
  vintage: number;
  thresholdCents: number;
  /** Échéance en secondes Unix. */
  dueDate: number;
}

/** Détail d'une transaction lu sur le nœud (`GET /api/tx/:hash`) : l'AlphaNet n'a pas d'explorer. */
export interface TxDetail {
  hash: string;
  type: string;
  /** Code du moteur (tesSUCCESS, tec…), absent sans métadonnées. */
  result?: string;
  validated: boolean;
  ledgerIndex?: number;
  /** Clôture du ledger, date ISO. */
  closeTime?: string;
  accounts: { role: string; address: string }[];
  fields: { name: string; value: string }[];
  createdObjects: { type: string; index: string }[];
  /** Transactions internes d'un `Batch`. */
  innerTransactions: { hash: string; type: string; account: string }[];
  certificate?: TxCertificate;
  /** Lien explorer, seulement sur un réseau qui en a un (devnet). */
  explorerUrl?: string;
  /** Transaction et métadonnées telles que renvoyées par le nœud. */
  raw: { tx: unknown; meta: unknown };
}
