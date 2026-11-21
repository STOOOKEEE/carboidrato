// Formats d'affichage (UI en anglais) : dollars US pour les factures, RLUSD pour le fonds, les prêteurs et les prêts.

const LOCALE = "en-GB";

const usdFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const dateFormatter = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", year: "numeric" });
const percentFormatter = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 });
const rlusdFormatter = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatUsd = (amount: number) => usdFormatter.format(amount);
export const formatRlusd = (amount: number) => `${rlusdFormatter.format(amount)} RLUSD`;
export const formatDate = (iso: string) => dateFormatter.format(new Date(iso));
export const formatPercent = (value: number) => `${percentFormatter.format(value)}%`;

/** Empreinte abrégée pour l'affichage : début et fin du hash. */
export function shortHash(hex: string, edge = 6): string {
  return hex.length <= edge * 2 ? hex : `${hex.slice(0, edge)}…${hex.slice(-edge)}`;
}
