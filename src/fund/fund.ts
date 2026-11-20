// Fonds en place : le Vault fermé d'une cohorte (un millésime) et le LoanBroker de Bari qui prête son actif.

import type { FundManifest } from "./fundManifest.js";

export interface Cohort {
  vaultId: string;
  shareMptId: string;
  /** Fin de la souscription (temps Ripple). */
  subscriptionDate: number;
  /** Début du rachat (temps Ripple). */
  redemptionDate: number;
}

export interface Fund {
  /** Actif du Vault (EURc). */
  assetId: string;
  domainId: string;
  cohort: Cohort;
  brokerId: string;
  manifest: FundManifest;
}
