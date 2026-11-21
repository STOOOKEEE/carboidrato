// Prix de la part du Vault, valeur d'une position, rendement variable et cotations de l'entrée/sortie immédiates par Bari.

import { STABLECOIN_ASSET_SCALE } from "../config/finance.js";
import { TENTH_BIPS_PER_PERCENT, percentToTenthBips } from "../lib/rates.js";

/** Remise de la sortie immédiate : Bari rachète les parts au prix de la part −0,5 %. */
export const IMMEDIATE_EXIT_DISCOUNT_PERCENT = 0.5;

/**
 * Parts d'une « part affichée » : le Vault RLUSD a Scale 6, une unité de part vaut une unité de RLUSD (10^-6) au
 * pair. Les prix par part sont donc exprimés en unités RLUSD pour 10^6 unités de part, et s'affichent comme un montant
 * RLUSD (1,000000 au pair).
 */
export const SHARE_DISPLAY_UNITS = 10n ** BigInt(STABLECOIN_ASSET_SCALE);

const TENTH_BIPS_PER_WHOLE = BigInt(100 * TENTH_BIPS_PER_PERCENT);
const EXIT_KEPT_TENTH_BIPS = TENTH_BIPS_PER_WHOLE - BigInt(percentToTenthBips(IMMEDIATE_EXIT_DISCOUNT_PERCENT));

/** Champs du Vault (et de l'émission de ses parts) qui fixent le prix, en unités. */
export interface VaultShares {
  assetsTotal: bigint;
  lossUnrealized: bigint;
  sharesOutstanding: bigint;
}

/** Prix exact de la part : `assets` unités RLUSD pour `shares` unités de part. */
export interface SharePrice {
  assets: bigint;
  shares: bigint;
}

/** (AssetsTotal − LossUnrealized) / OutstandingAmount ; au pair tant qu'aucune part n'est émise. */
export function sharePrice({ assetsTotal, lossUnrealized, sharesOutstanding }: VaultShares): SharePrice {
  if (sharesOutstanding === 0n) return { assets: 1n, shares: 1n };
  return { assets: assetsTotal - lossUnrealized, shares: sharesOutstanding };
}

/** `units` RLUSD pour `shares` unités de part, ramené à une part affichée (voir `SHARE_DISPLAY_UNITS`). */
export function perDisplayShare(units: bigint, shares: bigint): bigint {
  return (units * SHARE_DISPLAY_UNITS) / shares;
}

/** Valeur de `shares` unités de part au prix de la part, arrondie à l'unité inférieure. */
export function positionValue(price: SharePrice, shares: bigint): bigint {
  return (shares * price.assets) / price.shares;
}

/** Parts remises pour `amount` unités RLUSD à l'entrée immédiate, arrondies en faveur du fonds. */
export function entryShares(price: SharePrice, amount: bigint): bigint {
  return (amount * price.shares) / price.assets;
}

/** RLUSD versés pour `shares` unités de part à la sortie immédiate : prix de la part −0,5 %, arrondi inférieur. */
export function exitPayout(price: SharePrice, shares: bigint): bigint {
  return (shares * price.assets * EXIT_KEPT_TENTH_BIPS) / (price.shares * TENTH_BIPS_PER_WHOLE);
}

/** Liquidités de Bari hors Vault : son stock de parts et sa réserve RLUSD. */
export interface BariHoldings {
  shareStock: bigint;
  reserve: bigint;
}

export interface ImmediateLimits {
  /** RLUSD maximal d'une entrée immédiate : le stock de parts de Bari au prix de la part. */
  maxEntryAmount: bigint;
  /** Parts maximales d'une sortie immédiate : celles que la réserve RLUSD de Bari rachète à −0,5 %. */
  maxExitShares: bigint;
}

export function immediateLimits(price: SharePrice, { shareStock, reserve }: BariHoldings): ImmediateLimits {
  // Plus grand N tel que exitPayout(N) ≤ réserve : N × assets × gardé < (réserve + 1) × shares × entier.
  const maxExitShares =
    ((reserve + 1n) * price.shares * TENTH_BIPS_PER_WHOLE - 1n) / (price.assets * EXIT_KEPT_TENTH_BIPS);
  return { maxEntryAmount: positionValue(price, shareStock), maxExitShares };
}

/** Prêt en cours : principal restant dû et taux d'intérêt annuel en dixièmes de point de base. */
export interface ActiveLoan {
  principalOutstanding: bigint;
  interestRate: number;
}

/**
 * Rendement variable affiché : Σ (principal × taux × (1 − frais de gestion)) des prêts en cours / AssetsTotal,
 * en dixièmes de point de base (1 % = 1 000), arrondi inférieur.
 */
export function variableYieldTenthBips(loans: readonly ActiveLoan[], managementFeeRate: number, assetsTotal: bigint): number {
  if (assetsTotal <= 0n) return 0;
  const kept = TENTH_BIPS_PER_WHOLE - BigInt(managementFeeRate);
  const earning = loans.reduce((sum, loan) => sum + loan.principalOutstanding * BigInt(loan.interestRate), 0n);
  return Number((earning * kept) / (assetsTotal * TENTH_BIPS_PER_WHOLE));
}
