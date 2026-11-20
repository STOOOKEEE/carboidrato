// Formats d'affichage (UI en anglais, montants en euros).

const LOCALE = "en-GB";

const eurFormatter = new Intl.NumberFormat(LOCALE, { style: "currency", currency: "EUR" });
const dateFormatter = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", year: "numeric" });
const percentFormatter = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 });

export const formatEur = (amount: number) => eurFormatter.format(amount);
export const formatDate = (iso: string) => dateFormatter.format(new Date(iso));
export const formatPercent = (value: number) => `${percentFormatter.format(value)}%`;

/** Empreinte abrégée pour l'affichage : début et fin du hash. */
export function shortHash(hex: string, edge = 6): string {
  return hex.length <= edge * 2 ? hex : `${hex.slice(0, edge)}…${hex.slice(-edge)}`;
}
