// Décision de `npm run demo:fund` : réutiliser le fonds persisté ou en créer un nouveau.

import type { FundState } from "../api/fund/stateStore.js";

/** Marge avant le rachat : un fonds qui ferme dans la journée ne doit pas servir au pitch ni aux e2e. */
const MIN_REMAINING_INVESTMENT_S = 86_400;

/** Fonds alimenté, souscription close et rachat assez loin ; `now` en temps Ripple (heure du ledger). */
export function isReusable(state: FundState, now: number): boolean {
  if (!state.deposited || state.redeemed) return false;
  const { subscriptionDate, redemptionDate } = state.fund.cohort;
  return now >= subscriptionDate && redemptionDate - now >= MIN_REMAINING_INVESTMENT_S;
}
