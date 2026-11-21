// Calendrier compressé de la cohorte (Vault fermé). Durées en secondes, surchargeables par l'environnement.

/** Minimum imposé par le ledger entre SubscriptionDate et RedemptionDate. */
export const LEDGER_MIN_INVESTMENT_PERIOD_S = 180;
/** Le dernier paiement d'un prêt doit tomber au moins 60 s avant RedemptionDate. */
export const LEDGER_LOAN_REDEMPTION_BUFFER_S = 60;
/** Intervalle et période de grâce minimaux d'un prêt (LoanSet). */
export const LEDGER_MIN_PAYMENT_INTERVAL_S = 60;
export const LEDGER_MIN_GRACE_PERIOD_S = 60;
/** Marge pour l'écart entre l'heure du dernier ledger validé et celle du ledger qui inclura la transaction. */
export const LEDGER_TIME_SAFETY_MARGIN_S = 30;

const DEFAULT_SUBSCRIPTION_WINDOW_S = 60;
/** Au-dessus du minimum ledger : deux prêts et leurs contrôles doivent tenir avant le rachat. */
const DEFAULT_INVESTMENT_PERIOD_S = 240;

/** Millésime du fonds (entrée publique du circuit) : il borne la portée du pseudonyme P (IDEE §7.5). */
export const FUND_VINTAGE = 202611;

export interface CohortTiming {
  /** Délai entre la création du Vault et la fin de la souscription. */
  subscriptionWindowS: number;
  /** Durée de la phase d'investissement (SubscriptionDate → RedemptionDate). */
  investmentPeriodS: number;
}

/** Cohorte à date de rachat fixe (fonds durable) : la phase d'investissement court jusqu'à RedemptionDate. */
export interface FixedRedemptionTiming {
  subscriptionWindowS: number;
  /** RedemptionDate, en temps Ripple. */
  redemptionDate: number;
}

function readSeconds(name: string, fallback: number, minimum: number): number {
  const raw = process.env[name];
  const value = raw === undefined || raw.trim() === "" ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${name} doit être un entier ≥ ${minimum} (reçu : ${raw})`);
  }
  return value;
}

export function loadCohortTiming(): CohortTiming {
  return {
    subscriptionWindowS: readSeconds("COHORT_SUBSCRIPTION_S", DEFAULT_SUBSCRIPTION_WINDOW_S, 1),
    investmentPeriodS: readSeconds(
      "COHORT_INVESTMENT_S",
      DEFAULT_INVESTMENT_PERIOD_S,
      LEDGER_MIN_INVESTMENT_PERIOD_S,
    ),
  };
}
