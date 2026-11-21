// Montants MPT (parts du Vault et MPT facture) : des entiers.

import type { MPTAmount } from "xrpl";

export function mptAmount(issuanceId: string, units: bigint): MPTAmount {
  if (units <= 0n) throw new Error(`Montant MPT invalide : ${units}`);
  return { mpt_issuance_id: issuanceId, value: units.toString() };
}
