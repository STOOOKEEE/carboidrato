// Concentration par pseudonyme de débiteur P (IDEE §7.5 idée 3) : vérifiable par tous sans connaître le débiteur.

import { MAX_DEBTOR_CONCENTRATION_PERCENT } from "../config/finance.js";
import { percentOf } from "../lib/amounts.js";
import type { LoanRecord } from "./loanRecords.js";

export interface PseudonymExposure {
  pseudonym: string;
  loans: number;
  /** Principal total prêté sur ce débiteur depuis l'ouverture du fonds. */
  financed: bigint;
  /** Principal restant dû : c'est lui qui est plafonné. */
  outstanding: bigint;
}

export function exposuresByPseudonym(records: readonly LoanRecord[]): PseudonymExposure[] {
  const byPseudonym = new Map<string, PseudonymExposure>();
  for (const record of records) {
    if (record.reference instanceof Error) continue;
    const { pseudonym } = record.reference;
    const exposure = byPseudonym.get(pseudonym) ?? { pseudonym, loans: 0, financed: 0n, outstanding: 0n };
    exposure.loans += 1;
    exposure.financed += record.principal;
    exposure.outstanding += record.outstanding;
    byPseudonym.set(pseudonym, exposure);
  }
  return [...byPseudonym.values()];
}

/** Encours maximal admis sur un même débiteur, pour un fonds dont l'actif total est `fundAssets`. */
export function concentrationLimit(fundAssets: bigint): bigint {
  return percentOf(fundAssets, MAX_DEBTOR_CONCENTRATION_PERCENT);
}
