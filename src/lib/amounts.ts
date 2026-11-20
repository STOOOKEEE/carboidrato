// Conversions euros ↔ unités entières du MPT (les montants MPT sont des entiers).

import { STABLECOIN_ASSET_SCALE } from "../config/finance.js";
import { TENTH_BIPS_PER_PERCENT, percentToTenthBips } from "./rates.js";

const UNITS_PER_EUR = 10n ** BigInt(STABLECOIN_ASSET_SCALE);
const TENTH_BIPS_PER_UNIT = 100n * BigInt(TENTH_BIPS_PER_PERCENT);

export const CENTS_PER_EUR = 100;

export function eurToUnits(eur: number): bigint {
  if (!Number.isInteger(eur) || eur <= 0) {
    throw new Error(`Montant invalide : ${eur} € (entier strictement positif attendu)`);
  }
  return BigInt(eur) * UNITS_PER_EUR;
}

/** Unités → euros (nombre), pour l'affichage et les réponses JSON. */
export function unitsToEur(units: bigint): number {
  return Number(units) / Number(UNITS_PER_EUR);
}

export function centsToUnits(cents: number): bigint {
  if (!Number.isInteger(cents) || cents < 0) throw new Error(`Montant en centimes invalide : ${cents}`);
  return (BigInt(cents) * UNITS_PER_EUR) / BigInt(CENTS_PER_EUR);
}

/** Euros → centimes (entier), unité des montants prouvés dans le circuit. */
export function eurToCents(eur: number): bigint {
  if (!Number.isFinite(eur) || eur < 0) throw new Error(`Montant invalide : ${eur} €`);
  return BigInt(Math.round(eur * CENTS_PER_EUR));
}

export type Rounding = "down" | "up";

/** Part en pourcentage (décimales admises jusqu'au dixième de point de base), arrondie à l'unité. */
export function percentOf(units: bigint, percent: number, rounding: Rounding = "down"): bigint {
  if (percent <= 0 || percent > 100) throw new Error(`Pourcentage invalide : ${percent}`);
  const scaled = units * BigInt(percentToTenthBips(percent));
  const floor = scaled / TENTH_BIPS_PER_UNIT;
  return rounding === "up" && scaled % TENTH_BIPS_PER_UNIT !== 0n ? floor + 1n : floor;
}

const PERCENT_DISPLAY_DECIMALS = 2;

/** Pourcentage à la française (« 8,07 % »). */
export function formatPercent(value: number): string {
  return `${value.toLocaleString("fr-FR", { maximumFractionDigits: PERCENT_DISPLAY_DECIMALS })} %`;
}

/** Précision d'affichage d'un ratio : 4 décimales de pourcentage. */
const RATIO_PERCENT_DECIMALS = 10_000n;

/** Rapport part / total en pourcentage, pour l'affichage. */
export function ratioPercent(part: bigint, whole: bigint): number {
  if (whole <= 0n) throw new Error("Dénominateur nul ou négatif");
  return Number((part * 100n * RATIO_PERCENT_DECIMALS) / whole) / Number(RATIO_PERCENT_DECIMALS);
}

const LEDGER_NUMBER_PATTERN = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i;

/**
 * Parse un montant MPT renvoyé par le ledger (« 123 », « 123.5 » ou « 1.23e5 »).
 * Une partie fractionnaire éventuelle est arrondie à l'unité supérieure (cas d'un montant dû).
 */
export function parseUnits(value: string | number | undefined): bigint {
  if (value === undefined) return 0n;
  const match = LEDGER_NUMBER_PATTERN.exec(String(value));
  if (match === null) {
    throw new Error(`Montant MPT illisible : ${String(value)}`);
  }
  const [, sign, whole, fraction = "", exponentText = "0"] = match;
  const digits = BigInt(whole + fraction);
  const exponent = Number(exponentText) - fraction.length;
  let units: bigint;
  if (exponent >= 0) {
    units = digits * 10n ** BigInt(exponent);
  } else {
    const divisor = 10n ** BigInt(-exponent);
    units = digits / divisor + (digits % divisor === 0n ? 0n : 1n);
  }
  return sign === "-" ? -units : units;
}

/** Formate un montant ; `decimals` tronque l'affichage (2 pour des montants déjà arrondis au centime). */
export function formatEur(units: bigint, decimals: number = STABLECOIN_ASSET_SCALE): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const whole = abs / UNITS_PER_EUR;
  const fraction = (abs % UNITS_PER_EUR).toString().padStart(STABLECOIN_ASSET_SCALE, "0").slice(0, decimals);
  return `${negative ? "-" : ""}${whole.toLocaleString("fr-FR")},${fraction} EURc`;
}
