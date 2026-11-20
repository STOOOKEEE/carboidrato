// Opérations MPT génériques (stablecoin et MPT facture).

import type { Client, MPTAmount, Wallet } from "xrpl";
import { submitTx, type TxOutcome } from "./submit.js";

export function mptAmount(issuanceId: string, units: bigint): MPTAmount {
  if (units <= 0n) throw new Error(`Montant MPT invalide : ${units}`);
  return { mpt_issuance_id: issuanceId, value: units.toString() };
}

/** Le détenteur crée son objet MPToken pour pouvoir recevoir l'émission. */
export function authorizeMpt(client: Client, issuanceId: string, holder: Wallet, holderName: string) {
  return submitTx(
    client,
    { TransactionType: "MPTokenAuthorize", Account: holder.address, MPTokenIssuanceID: issuanceId },
    holder,
    `MPTokenAuthorize ${holderName}`,
  );
}

export function sendMpt(
  client: Client,
  issuanceId: string,
  from: Wallet,
  to: string,
  units: bigint,
  label: string,
): Promise<TxOutcome> {
  return submitTx(
    client,
    { TransactionType: "Payment", Account: from.address, Destination: to, Amount: mptAmount(issuanceId, units) },
    from,
    label,
  );
}
