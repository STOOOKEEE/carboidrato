// Paramètres du serveur du fonds (src/api/fund) : tout vient de l'environnement, avec des valeurs de démo.

import { basename, dirname, join } from "node:path";
import type { NetworkConfig } from "../../config/network.js";

const DEFAULT_PORT = 8788;
/** Écoute locale uniquement : le serveur détient les wallets de démo. */
const DEFAULT_HOST = "127.0.0.1";
/** Origine du serveur de développement Vite (npm run web). */
const DEFAULT_CORS_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];
const WALLETS_FILE_PATTERN = /^\.wallets\.(.+)\.json$/;
const DEFAULT_STATE_FILE = ".bari-state.json";
const MAX_PORT = 65_535;

export interface ApiConfig {
  host: string;
  port: number;
  corsOrigins: string[];
  /** Fichier (gitignoré) où l'état du fonds courant est persisté. */
  stateFile: string;
}

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

function readPort(): number {
  const raw = readEnv("API_FUND_PORT");
  const port = raw === undefined ? DEFAULT_PORT : Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > MAX_PORT) throw new Error(`API_FUND_PORT invalide : ${raw}`);
  return port;
}

/** `.wallets.devnet.api.json` → `.bari-state.devnet.api.json` : un état par jeu de comptes et par réseau. */
function defaultStateFile(walletsFile: string): string {
  const match = WALLETS_FILE_PATTERN.exec(basename(walletsFile));
  const name = match === null ? DEFAULT_STATE_FILE : `.bari-state.${match[1]}.json`;
  return join(dirname(walletsFile), name);
}

export function loadApiConfig(network: NetworkConfig): ApiConfig {
  const origins = readEnv("API_CORS_ORIGIN");
  return {
    host: readEnv("API_FUND_HOST") ?? DEFAULT_HOST,
    port: readPort(),
    corsOrigins: origins === undefined ? DEFAULT_CORS_ORIGINS : origins.split(",").map((origin) => origin.trim()),
    stateFile: readEnv("BARI_STATE_FILE") ?? defaultStateFile(network.walletsFile),
  };
}
