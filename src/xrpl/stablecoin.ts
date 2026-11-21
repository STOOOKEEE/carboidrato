// RLUSD, stablecoin du fonds : jeton de ligne de confiance (IOU). Le ledger exprime ses montants en valeur décimale
// (« 8955.5 ») ; Bari compte en unités entières de 10^-6 RLUSD, à l'échelle du Vault (Scale 6 : une unité, une part).

import { convertHexToString, type Client, type IssuedCurrencyAmount, type Payment, type TrustSet } from "xrpl";
import { STABLECOIN_ASSET_SCALE } from "../config/finance.js";
import { parseScaled, type Rounding } from "../lib/amounts.js";

/** Actif du Vault : une devise et son émetteur. */
export interface Stablecoin {
  currency: string;
  issuer: string;
}

/** « RLUSD » en code de devise non standard : 20 octets en hexadécimal, complétés de zéros. */
export const RLUSD_CURRENCY = "524C555344000000000000000000000000000000";
/** Plafond des lignes de confiance des détenteurs, très au-delà des montants du fonds. */
const TRUST_LIMIT = "1000000000000";
const UNITS_PER_TOKEN = 10n ** BigInt(STABLECOIN_ASSET_SCALE);
const HEX_CURRENCY = /^[0-9A-F]{40}$/i;

/** Unités → valeur décimale du ledger, sans zéros inutiles. */
export function unitsToValue(units: bigint): string {
  if (units < 0n) throw new Error(`Montant négatif : ${units}`);
  const whole = units / UNITS_PER_TOKEN;
  const fraction = (units % UNITS_PER_TOKEN).toString().padStart(STABLECOIN_ASSET_SCALE, "0").replace(/0+$/, "");
  return fraction === "" ? whole.toString() : `${whole}.${fraction}`;
}

/**
 * Valeur du ledger (« 9000 », « 8955.5 », « 1.23e5 ») → unités. Au-delà de 6 décimales : arrondi supérieur par défaut
 * (un dû n'est jamais sous-estimé), inférieur pour un solde (on ne dépense jamais plus que ce qu'on détient).
 */
export function valueToUnits(value: string | number | undefined, rounding: Rounding = "up"): bigint {
  return parseScaled(value, STABLECOIN_ASSET_SCALE, rounding);
}

export function stablecoinAmount(asset: Stablecoin, units: bigint): IssuedCurrencyAmount {
  if (units <= 0n) throw new Error(`Montant RLUSD invalide : ${units}`);
  return { currency: asset.currency, issuer: asset.issuer, value: unitsToValue(units) };
}

/** Ligne de confiance du détenteur vers l'émetteur : sans elle, un compte ne peut ni recevoir ni détenir l'actif. */
export function trustLine(asset: Stablecoin, holder: string): TrustSet {
  return {
    TransactionType: "TrustSet",
    Account: holder,
    LimitAmount: { currency: asset.currency, issuer: asset.issuer, value: TRUST_LIMIT },
  };
}

export function stablecoinPayment(asset: Stablecoin, from: string, to: string, units: bigint): Payment {
  return { TransactionType: "Payment", Account: from, Destination: to, Amount: stablecoinAmount(asset, units) };
}

/** Code de devise lisible : un code non standard (40 caractères hex) devient son texte ASCII (« RLUSD »). */
export function currencyLabel(code: string): string {
  return HEX_CURRENCY.test(code) ? convertHexToString(code).replace(/\0+$/, "") : code;
}

/** Ligne de confiance d'un compte pour l'actif, undefined s'il n'en a pas. */
export async function findTrustLine(client: Client, asset: Stablecoin, account: string) {
  const response = await client.request({ command: "account_lines", account, peer: asset.issuer, ledger_index: "validated" });
  return response.result.lines.find((line) => line.currency === asset.currency);
}

/** Solde d'un compte en unités, arrondi à l'unité inférieure (0 sans ligne de confiance). */
export async function getStablecoinBalance(client: Client, asset: Stablecoin, account: string): Promise<bigint> {
  return valueToUnits((await findTrustLine(client, asset, account))?.balance, "down");
}
