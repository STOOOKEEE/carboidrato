// Espace prêteur, pur : montants saisis en unités exactes, contrôle et aperçu des ordres, opérations et historique.

import type { LenderFaucetResponse, LenderPosition, LenderTradeResponse, LenderTradeRoute } from "../../../../src/api/contract";
import { formatEur } from "../../format";

/** EURc et parts ont 6 décimales : une part affichée = 10^6 unités, un euro = 10^6 unités EURc. */
const DECIMALS = 6;
const UNIT = 10n ** BigInt(DECIMALS);
const UNITS_PER_CENT = UNIT / 100n;
const EURO_DECIMALS = 2;
const TENTH_BIPS_PER_PERCENT = 1_000;
const TENTH_BIPS_PER_WHOLE = 100n * BigInt(TENTH_BIPS_PER_PERCENT);
const AMOUNT_PATTERN = /^(\d*)(?:\.(\d*))?$/;

export type Parsed = { ok: true; units: bigint } | { ok: false; error: string };

function parseFixed(text: string, maxDecimals: number, example: string): Parsed {
  const cleaned = text.replace(/[\s,€]/g, "");
  if (cleaned === "") return { ok: false, error: "Enter an amount" };
  const match = AMOUNT_PATTERN.exec(cleaned);
  const whole = match?.[1] ?? "";
  const fraction = match?.[2] ?? "";
  if (match === null || whole + fraction === "") return { ok: false, error: `Enter a number, e.g. ${example}` };
  if (fraction.length > maxDecimals) return { ok: false, error: `Use at most ${maxDecimals} decimals` };
  const units = BigInt(whole === "" ? "0" : whole) * UNIT + BigInt(fraction.padEnd(DECIMALS, "0"));
  return units === 0n ? { ok: false, error: "Enter an amount above zero" } : { ok: true, units };
}

/** Euros saisis (au centime) → unités EURc, sans passer par un flottant. */
export const parseEuros = (text: string) => parseFixed(text, EURO_DECIMALS, "5000");

/** Parts saisies → unités de part. */
export const parseShares = (text: string) => parseFixed(text, DECIMALS, "1000");

function fractionDigits(units: bigint): string {
  return (units % UNIT).toString().padStart(DECIMALS, "0").replace(/0+$/, "");
}

/** Saisie exacte de `units` parts, relue telle quelle par `parseShares`. */
export function sharesInput(units: bigint): string {
  const fraction = fractionDigits(units);
  return fraction === "" ? (units / UNIT).toString() : `${units / UNIT}.${fraction}`;
}

const grouped = new Intl.NumberFormat("en-GB");

/** Parts exactes, au moins 2 décimales. */
export function formatShares(units: bigint): string {
  return `${grouped.format(units / UNIT)}.${fractionDigits(units).padEnd(EURO_DECIMALS, "0")}`;
}

/** Unités EURc en euros, tronquées au centime : un maximum affiché ne dépasse jamais le vrai maximum. */
export const formatEurUnits = (units: bigint) => formatEur(Number(units / UNITS_PER_CENT) / 100);

const sharePriceFormatter = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 4,
  maximumFractionDigits: DECIMALS,
});

/** Prix de la part (unités EURc par part affichée) : ses variations se lisent après le centime. */
export const formatSharePrice = (units: string) => sharePriceFormatter.format(Number(units) / Number(UNIT));

export interface TradePreview {
  route: LenderTradeRoute;
  /** EURc versés (dépôt) ou reçus (retrait), en unités. */
  eurc: bigint;
  /** Parts reçues (dépôt) ou rendues (retrait), en unités. */
  shares: bigint;
  /** Remise de la sortie immédiate, en unités EURc. */
  fee: bigint;
}

export const ROUTE_LABELS: Record<LenderTradeRoute, string> = {
  native: "Directly with the fund's vault",
  immediate: "Immediate, through Bari",
};

export type TradeCheck = { ok: true; amount: bigint; preview: TradePreview } | { ok: false; error: string };

const refuse = (error: string): TradeCheck => ({ ok: false, error });

/** Euros → parts au prix de la part (EURc par part affichée), arrondi en faveur du fonds comme l'API. */
export function checkDeposit(position: LenderPosition, input: string): TradeCheck {
  const { route } = position.entry;
  if (route === null) return refuse("Deposits are closed: the fund is repaying its lenders. You can still withdraw.");
  const parsed = parseEuros(input);
  if (!parsed.ok) return parsed;
  const amount = parsed.units;
  const balance = BigInt(position.eurcBalance);
  const max = BigInt(position.entry.max);
  if (amount > balance) {
    return refuse(
      balance === 0n
        ? "Your balance is empty: add test euros first."
        : `Above your balance of ${formatEurUnits(balance)}. Enter at most ${formatEurUnits(max)}.`,
    );
  }
  if (amount > max) {
    const cap = BigInt(position.entry.bariCap ?? position.entry.max);
    return refuse(`Bari can sell at most ${formatEurUnits(cap)} of fund shares right now. Enter at most ${formatEurUnits(max)}.`);
  }
  const shares = (amount * UNIT) / BigInt(position.sharePrice);
  if (shares === 0n) return refuse("Amount too small to buy a share.");
  return { ok: true, amount, preview: { route, eurc: amount, shares, fee: 0n } };
}

/** Parts → euros au prix de la part ; la sortie immédiate retient la remise de Bari, arrondi inférieur comme l'API. */
export function checkWithdraw(position: LenderPosition, input: string): TradeCheck {
  const { route } = position.exit;
  if (route === null) return refuse("Withdrawals are closed right now.");
  const held = BigInt(position.shares);
  if (held === 0n) return refuse("You hold no shares yet: deposit first.");
  const parsed = parseShares(input);
  if (!parsed.ok) return parsed;
  const shares = parsed.units;
  const max = BigInt(position.exit.max);
  if (shares > held) return refuse(`You hold ${formatShares(held)} shares. Enter at most ${formatShares(max)}.`);
  if (shares > max) {
    const cap = BigInt(position.exit.bariCap ?? position.exit.max);
    return refuse(
      `Bari's reserve buys back at most ${formatShares(cap)} shares right now. Enter at most ${formatShares(max)}, or exit for free at maturity.`,
    );
  }
  const price = BigInt(position.sharePrice);
  const gross = (shares * price) / UNIT;
  const kept = TENTH_BIPS_PER_WHOLE - BigInt(Math.round(position.immediateExitDiscountPercent * TENTH_BIPS_PER_PERCENT));
  const eurc = route === "immediate" ? (shares * price * kept) / (UNIT * TENTH_BIPS_PER_WHOLE) : gross;
  if (eurc === 0n) return refuse("Amount too small to receive any euros.");
  return { ok: true, amount: shares, preview: { route, eurc, shares, fee: gross - eurc } };
}

/** Champs de `GET /api/fund` lus par la carte du fonds (unités EURc en chaînes). */
export interface LendFund {
  subscriptionEndsAt: string;
  redemptionStartsAt: string;
  vault: { assetsTotal: string; assetsAvailable: string };
  broker: { coverAvailable: string };
  loans: unknown[];
}

/** Part des actifs du fonds prêtée, en %, tronquée au centième. */
export function utilisationPercent({ assetsTotal, assetsAvailable }: LendFund["vault"]): number {
  const total = BigInt(assetsTotal);
  if (total === 0n) return 0;
  return Number(((total - BigInt(assetsAvailable)) * 10_000n) / total) / 100;
}

export type LendAction = "faucet" | "deposit" | "withdraw";

export interface Movement {
  action: LendAction;
  route?: LenderTradeRoute;
  /** EURc reçus (faucet, retrait) ou versés (dépôt), en unités. */
  eurc: bigint;
  shares?: bigint;
  /** Transaction principale (VaultDeposit / VaultWithdraw, Batch externe, Payment). */
  hash: string;
  /** Toutes les transactions de l'opération, la principale en tête. */
  hashes: string[];
}

const hashesOf = (hash: string, transactions: { hash: string }[]) => [...new Set([hash, ...transactions.map((tx) => tx.hash)])];

export const faucetMovement = ({ hash, amount, transactions }: LenderFaucetResponse): Movement => ({
  action: "faucet",
  eurc: BigInt(amount),
  hash,
  hashes: hashesOf(hash, transactions),
});

export const tradeMovement = (action: "deposit" | "withdraw", response: LenderTradeResponse): Movement => ({
  action,
  route: response.route,
  eurc: BigInt(response.amount),
  shares: BigInt(response.shares),
  hash: response.hash,
  hashes: hashesOf(response.hash, response.transactions),
});

export function movementSummary({ action, eurc, shares = 0n }: Movement): string {
  switch (action) {
    case "faucet":
      return `Received ${formatEurUnits(eurc)} of test euros`;
    case "deposit":
      return `Deposited ${formatEurUnits(eurc)} for ${formatShares(shares)} shares`;
    case "withdraw":
      return `Sold ${formatShares(shares)} shares for ${formatEurUnits(eurc)}`;
  }
}

export type Operation =
  | { status: "idle" }
  | { status: "submitting"; action: LendAction }
  | { status: "done"; movement: Movement }
  | { status: "failed"; action: LendAction; message: string };

export interface LendState {
  operation: Operation;
  /** Mouvements de la session, le plus récent en tête. */
  history: Movement[];
}

export type LendEvent =
  | { type: "SUBMIT"; action: LendAction }
  | { type: "SUCCEEDED"; movement: Movement }
  | { type: "FAILED"; message: string };

export const initialLendState: LendState = { operation: { status: "idle" }, history: [] };

// Une opération à la fois : l'API sérialise déjà les transactions des comptes partagés.
export function lendTransition(state: LendState, event: LendEvent): LendState {
  const { operation } = state;
  switch (event.type) {
    case "SUBMIT":
      return operation.status === "submitting" ? state : { ...state, operation: { status: "submitting", action: event.action } };
    case "SUCCEEDED":
      if (operation.status !== "submitting" || operation.action !== event.movement.action) return state;
      return { operation: { status: "done", movement: event.movement }, history: [event.movement, ...state.history] };
    case "FAILED":
      if (operation.status !== "submitting") return state;
      return { ...state, operation: { status: "failed", action: operation.action, message: event.message } };
  }
}
