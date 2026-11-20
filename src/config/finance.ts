// Paramètres financiers de Bari (IDEE §4). Montants en euros, taux en pourcentage (annuel pour les intérêts).

/** Décimales du stablecoin EURc : 6 pour que les intérêts d'une cohorte compressée restent visibles. */
export const STABLECOIN_ASSET_SCALE = 6;

/** Facture type de la démo : 10 000 € payables à 90 jours par la mairie. */
export const INVOICE_AMOUNT_EUR = 10_000;
export const INVOICE_TERM_DAYS = 90;

/** Avance : le principal du prêt vaut 90 % de la facture (9 000 €). */
export const ADVANCE_RATE_PERCENT = 90;
/** Frais de dossier prélevés à l'octroi (LoanOriginationFee) : 0,5 % du principal, soit 45 €. */
export const ORIGINATION_FEE_PERCENT = 0.5;

export const INTEREST_RATE_PERCENT = 6;
export const LATE_INTEREST_RATE_PERCENT = 9;
/** Part des intérêts qui revient à Bari (ManagementFeeRate, max ledger : 10 %). */
export const MANAGEMENT_FEE_RATE_PERCENT = 1;

/** Mise en première perte de Bari, en % de l'encours (CoverRateMinimum). */
export const COVER_RATE_MINIMUM_PERCENT = 10;
/** Part de la couverture minimale liquidée en cas de défaut. */
export const COVER_RATE_LIQUIDATION_PERCENT = 100;

/** Plafond d'exposition par pseudonyme de débiteur P, en % de l'actif du fonds (IDEE §7.5 idée 3). */
export const MAX_DEBTOR_CONCENTRATION_PERCENT = 20;

/** Dépôts des investisseurs : 100 000 € au total, pour que 2 factures du même débiteur restent sous le plafond. */
export const INVESTOR_DEPOSITS_EUR = { investor_1: 60_000, investor_2: 40_000 } as const;

/** Nombre de factures financées par le scénario (deux, du même débiteur, pour illustrer la concentration). */
export const DEMO_INVOICE_COUNT = 2;
