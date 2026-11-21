// Contrat entre l'API du fonds et le front (web/) : types seuls, sans dépendance Node,
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
export const CHECK_IDS = ["signature", "debtor", "network", "amount", "dueDate", "unique"] as const;
export type CheckId = (typeof CHECK_IDS)[number];

export interface CheckResult {
  id: CheckId;
  ok: boolean;
}

/** Offre de financement du fonds, montants en euros arrondis au centime : l'avance est fixe, adossée au seuil prouvé. */
export interface LoanOffer {
  /** La preuve garantit que la facture vaut au moins ce montant ; son montant exact reste privé. */
  provenThresholdEur: number;
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
  /** Transaction qui a déjà enregistré N, si la facture est déjà financée. */
  registeredBy?: string;
  offer?: LoanOffer;
}

/** Valeurs publiques que la preuve doit lier (`GET /api/proof/params`). */
export interface ProofParams {
  networkId: number;
  /** Adresse XRPL du registre Bari. */
  registry: string;
  /**
   * Paliers publics de l'offre, en centimes (décimal), croissants : le navigateur prouve le plus grand qui ne dépasse
   * pas le montant de la facture ; seul ce palier devient public.
   */
  thresholdsCents: string[];
  /** Millésime du fonds, portée du pseudonyme P. */
  vintage: number;
  /** Artefacts du circuit servis par l'API. */
  artifacts: { wasm: string; zkey: string; verificationKey: string };
}

/** Enregistrement de N dans le registre on-chain (`GET /api/registry/:nullifier?account=`). */
export interface RegistryLookup {
  registered: boolean;
  /** Dernière transaction qui a touché l'enregistrement (sa création). */
  txHash?: string;
}

/** Corps de `POST /api/sme/certificate` : la preuve et ses signaux publics, rien du témoin. */
export interface CertificateRequest {
  proof: { pi_a: string[]; pi_b: string[][]; pi_c: string[]; protocol: string; curve: string };
  publicSignals: string[];
}

/** Ordre de `publicSignals` (sorties puis entrées publiques du circuit), le même que `src/zk/statement.ts`. */
export const PROOF_PUBLIC_SIGNALS = [
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

/** Transaction soumise par l'API pendant une opération. */
export interface SubmittedTx {
  label: string;
  hash: string;
  result: string;
}

/** Réponse de `POST /api/sme/certificate` : MPT facture émis, valeurs publiques de la preuve. */
export interface CertificateResponse {
  tokenId: string;
  nullifier: string;
  pseudonym: string;
  commitment: string;
  proofSystem: string;
  transactions: SubmittedTx[];
}

export interface KybStatus {
  account: string;
  done: boolean;
}

export interface ApiError {
  error: string;
}

export type UserRole = "lender" | "business" | "public_body";

/** Niveau de vérification affiché tel quel : le KYC des prêteurs et des entreprises est déclaratif. */
export type VerificationLevel = "basic (self-declared)" | "verified public body registry";

/** Formulaire d'inscription, un profil par rôle (KYC léger). */
export type SignupRequest = { email: string; password: string } & (
  | { role: "lender"; profile: { name: string; country: string; riskAcknowledged: true } }
  | { role: "business"; profile: { company: string; vatNumber: string } }
  | { role: "public_body"; profile: { ipaCode: string } }
);

export interface SigninRequest {
  email: string;
  password: string;
}

/** Compte de la session (`GET /api/me`) : jamais de seed ni de haché. */
export type AccountView = {
  email: string;
  /** Compte XRPL géré par Bari (absent pour un organisme public). */
  address?: string;
  verification: VerificationLevel;
} & (
  | { role: "lender"; profile: { name: string; country: string } }
  | { role: "business"; profile: { company: string; vatNumber: string } }
  | { role: "public_body"; profile: { ipaCode: string; name: string } }
);

export interface SignupResponse {
  user: AccountView;
  /** Transactions d'ouverture du compte, pour l'écran « Verifying… ». */
  transactions: SubmittedTx[];
}

export interface SigninResponse {
  user: AccountView;
}

/** Organisme du registre vérifié (`GET /api/public-bodies`), proposé à l'inscription ; un seul compte par organisme. */
export interface PublicBodyOption {
  ipaCode: string;
  name: string;
  available: boolean;
}

/**
 * Clés d'attestation de l'organisme de la session (`GET /api/public-body/keys`) : la facture est signée dans
 * son navigateur. Clés en hex ; clé publique EdDSA BabyJubJub, entiers du corps en décimal.
 */
export interface PublicBodyKeys {
  name: string;
  ipaCode: string;
  eddsaPrivateKey: string;
  /** Clé HMAC de l'uuid : uuid = HMAC(numéro canonique), la même facture signée deux fois donne le même N. */
  hmacKey: string;
  publicKey: { ax: string; ay: string };
}

/** Fournisseur retrouvé par son n° de TVA (`GET /api/businesses/by-vat/:vat`). */
export interface BusinessLookup {
  company: string;
  vatNumber: string;
  /** Compte XRPL du fournisseur, lié par l'attestation. */
  address: string;
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

// Espace entreprise : barème de l'offre, contrôles de Bari avant co-signature, factures du compte de la session.

/**
 * Barème public de l'offre (`GET /api/offer?dueDate=`) : le montant de la facture reste dans le navigateur, qui y lit
 * l'offre de son palier (le dernier dont le seuil ne dépasse pas ce montant ; aucun sous le premier).
 */
export interface OfferSchedule {
  advanceRatePercent: number;
  /** Frais de dossier, en % de l'avance. */
  feeRatePercent: number;
  interestRatePercent: number;
  /** Durée du prêt jusqu'à `loanDueDate`. */
  termDays: number;
  /** Échéance du prêt (ISO) : celle de la facture, bornée par le rachat du fonds. */
  loanDueDate: string;
  /** Une offre par seuil public, seuils croissants. */
  tiers: LoanOffer[];
}

export type LoanCheckId = "kyb" | "proof" | "advance" | "unique" | "concentration" | "maturity";

/** Contrôle de Bari avant de co-signer le prêt ; `reason` explique un échec. */
export interface LoanCheck {
  id: LoanCheckId;
  label: string;
  ok: boolean;
  reason?: string;
}

/** Montant en unités RLUSD (6 décimales : 1 RLUSD = 10^6 unités), en chaîne décimale. */
export type RlusdUnits = string;

/** Réponse de `POST /api/sme/loan` (201). */
export interface LoanResponse {
  loanId: string;
  tokenId: string;
  checks: LoanCheck[];
  principal: RlusdUnits;
  originationFee: RlusdUnits;
  /** Ce que l'entreprise reçoit : principal − frais. */
  netAdvance: RlusdUnits;
  /** Échéance du prêt (ISO). */
  dueDate: string;
  /** Hash du `LoanSet` co-signé. */
  txHash: string;
  transactions: SubmittedTx[];
}

/** Refus de `POST /api/sme/loan` (422) : `error` reprend la raison du premier contrôle en échec. */
export interface LoanRefusal {
  error: string;
  checks: LoanCheck[];
  transactions: SubmittedTx[];
}

export type BusinessInvoiceStatus = "certified" | "active" | "repaid" | "defaulted";

/** Facture du compte de la session (`GET /api/business/invoices`) ; champs du prêt présents une fois financée. */
export interface BusinessInvoice {
  tokenId: string;
  nullifier: string;
  status: BusinessInvoiceStatus;
  /** Date d'émission du certificat (ISO). */
  issuedAt: string;
  /** Hash du `Batch` du certificat. */
  certificateTxHash?: string;
  loanId?: string;
  /** Hash du `LoanSet`. */
  loanTxHash?: string;
  principal?: RlusdUnits;
  originationFee?: RlusdUnits;
  /** Échéance du prêt (ISO). */
  dueDate?: string;
}

// Espace prêteur : position, faucet de RLUSD de test, dépôt et retrait (natifs ou immédiats par Bari selon la phase).

export type FundPhase = "subscription" | "investment" | "redemption";

/** `native` : VaultDeposit / VaultWithdraw ; `immediate` : Batch atomique avec Bari pendant la période de prêt. */
export type LenderTradeRoute = "native" | "immediate";

/** Montant en unités de part du Vault, en chaîne décimale ; une part affichée = 10^6 unités (1 RLUSD au pair). */
export type ShareUnits = string;

/** Ce que le prêteur de la session peut passer dans un sens, dans la phase courante. */
export interface LenderTradeLimit {
  /** Chemin de l'ordre ; null si ce sens est fermé (dépôt pendant le rachat). */
  route: LenderTradeRoute | null;
  /** Maximum accepté : min(solde du prêteur, plafond de Bari). Entrée en RLUSD, sortie en parts. */
  max: RlusdUnits | ShareUnits;
  /** Chemin immédiat : stock de parts de Bari au prix de la part (entrée, RLUSD), parts que sa réserve rachète (sortie). */
  bariCap?: RlusdUnits | ShareUnits;
}

/** `GET /api/lender/position`. Les prix sont en unités RLUSD par part affichée (10^6 unités de part). */
export interface LenderPosition {
  phase: FundPhase;
  shares: ShareUnits;
  /** Valeur des parts au prix de la part. */
  value: RlusdUnits;
  /** RLUSD payés pour les parts détenues. */
  costBasis: RlusdUnits;
  /** Prix moyen d'achat par part affichée ; absent sans achat suivi. */
  averageCost?: RlusdUnits;
  /** value − costBasis, négatif en cas de perte. */
  gain: RlusdUnits;
  /** (AssetsTotal − LossUnrealized) / parts en circulation, par part affichée. */
  sharePrice: RlusdUnits;
  /** Rendement annuel variable des prêts en cours, net des frais de gestion de Bari, en %. */
  variableYieldPercent: number;
  rlusdBalance: RlusdUnits;
  entry: LenderTradeLimit;
  exit: LenderTradeLimit;
  /** Remise de la sortie immédiate sur le prix de la part, en %. */
  immediateExitDiscountPercent: number;
}

/** Corps de `POST /api/lender/deposit` (`amount` en unités RLUSD) et `POST /api/lender/withdraw` (`amount` en unités de part). */
export interface LenderTradeRequest {
  amount: string;
}

export interface LenderTradeResponse {
  /** Hash du VaultDeposit / VaultWithdraw, ou du Batch externe. */
  hash: string;
  route: LenderTradeRoute;
  phase: FundPhase;
  /** RLUSD versés (dépôt) ou reçus (retrait). */
  amount: RlusdUnits;
  /** Parts reçues (dépôt) ou rendues (retrait). */
  shares: ShareUnits;
  transactions: SubmittedTx[];
}

/** `POST /api/lender/faucet` : RLUSD de test envoyés au compte géré du prêteur. */
export interface LenderFaucetResponse {
  hash: string;
  amount: RlusdUnits;
  transactions: SubmittedTx[];
}

// Page Transparency : audit public du fonds, relu du ledger seul.

export type AuditLoanStatus = "active" | "repaid" | "impaired" | "defaulted";

/** Prêt du fonds relu sur le ledger : la preuve de sa facture se re-vérifie dans le navigateur. */
export interface AuditLoan {
  loanId: string;
  loanSequence: number;
  /** Hash du `LoanSet`. */
  loanSetHash: string;
  borrower: string;
  principal: RlusdUnits;
  /** Principal restant dû. */
  outstanding: RlusdUnits;
  status: AuditLoanStatus;
  /** Prochaine échéance (ISO), absente une fois le prêt soldé. */
  dueDate?: string;
  /** Référence du `LoanSet` au certificat (hex 32 octets, ID du MPT facture), absente si son Data est illisible. */
  reference?: { nullifier: string; pseudonym: string; invoiceTokenId: string };
  /** Preuve Groth16 et signaux publics lus dans les métadonnées du MPT facture, absents s'ils sont illisibles. */
  certificate?: CertificateRequest;
  /** Anomalies relevées par l'audit du serveur. */
  anomalies: number;
}

/** `GET /api/audit` : public, montants en unités RLUSD. */
export interface FundAudit {
  vaultId: string;
  brokerId: string;
  /** Propriétaire du LoanBroker : Bari. */
  owner: string;
  /** Fiche du fonds (Data du Vault) : les entrées publiques que chaque preuve doit lier. */
  manifest: { debtorsRoot: string; vintage: number; registry: string };
  loans: number;
  /** Preuves valides selon le serveur ; le navigateur refait le calcul. */
  verifiedProofs: number;
  anomalies: number;
  fundAssets: RlusdUnits;
  /** Prix de la part, en unités RLUSD par part affichée. */
  sharePrice: RlusdUnits;
  /** Plafond d'encours par débiteur, en % de l'actif du fonds. */
  concentrationLimitPercent: number;
  loanAudits: AuditLoan[];
}
