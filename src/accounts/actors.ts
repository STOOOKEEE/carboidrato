// Comptes XRPL des acteurs (IDEE §5) : réutilisés s'ils existent et sont financés, sinon créés et financés.

import { Wallet, dropsToXrp, xrpToDrops, type Client } from "xrpl";
import type { NetworkConfig } from "../config/network.js";
import { log } from "../lib/logger.js";
import { getXrpBalanceDrops } from "../xrpl/ledgerEntries.js";
import { makeFunder } from "./funding.js";
import { loadSeeds, saveSeeds } from "./walletStore.js";

export const ACTOR_NAMES = [
  // Plateforme : propriétaire du Vault et du broker, apporte la first-loss, co-signe les prêts.
  "bari",
  // Compte registre de Bari : sujet des credentials N émis par les PME.
  "bari_registry",
  // Prestataire KYC/KYB (investisseurs, PME).
  "kyb_issuer",
  "stable_issuer",
  "investor_1",
  "investor_2",
  // La PME de Marco : emprunteuse et émettrice des MPT facture.
  "sme",
  // La mairie débitrice : atteste les factures (hors chaîne) et les paie à l'échéance.
  "mairie",
] as const;

export type ActorName = (typeof ACTOR_NAMES)[number];
export const INVESTORS = ["investor_1", "investor_2"] as const;
export type Actors = Record<ActorName, Wallet>;

/** En dessous de ce solde, un compte réutilisé est re-financé (réserves + frais d'un scénario). */
const MIN_BALANCE_XRP = 30;

export async function ensureActors(client: Client, network: NetworkConfig): Promise<Actors> {
  const seeds = loadSeeds(network.walletsFile);
  const fund = makeFunder(client, network);
  const minimumDrops = BigInt(xrpToDrops(MIN_BALANCE_XRP));
  const actors: Partial<Actors> = {};

  for (const name of ACTOR_NAMES) {
    const knownSeed = seeds[name];
    const wallet = knownSeed === undefined ? Wallet.generate() : Wallet.fromSeed(knownSeed);
    if (knownSeed === undefined) {
      if (wallet.seed === undefined) throw new Error(`Seed non générée pour ${name}`);
      seeds[name] = wallet.seed;
      saveSeeds(network.walletsFile, seeds);
    }
    const balance = await getXrpBalanceDrops(client, wallet.address);
    if (balance === undefined || balance < minimumDrops) {
      await fund(wallet, name);
      log.info(`${name.padEnd(16)} ${wallet.address}  financé`);
    } else {
      log.info(`${name.padEnd(16)} ${wallet.address}  réutilisé (${dropsToXrp(balance.toString())} XRP)`);
    }
    actors[name] = wallet;
  }
  return actors as Actors;
}

/** Comptes déjà créés par la démo, sans création ni financement (API de pré-contrôle). */
export function loadActors(network: NetworkConfig): Actors {
  const seeds = loadSeeds(network.walletsFile);
  const missing = ACTOR_NAMES.filter((name) => seeds[name] === undefined);
  if (missing.length > 0) {
    throw new Error(`Comptes absents de ${network.walletsFile} (${missing.join(", ")}) : lancer d'abord npm run demo`);
  }
  return Object.fromEntries(ACTOR_NAMES.map((name) => [name, Wallet.fromSeed(seeds[name])])) as Actors;
}
