// Paramètres réseau : tout vient de l'environnement pour pouvoir basculer devnet ↔ alphanet.

const DEFAULT_WS_URL = "wss://s.devnet.rippletest.net:51233";
const DEFAULT_FAUCET_HOST = "faucet.devnet.rippletest.net";
const DEFAULT_WALLETS_FILE = ".wallets.devnet.json";
const DEFAULT_EXPLORER_URL = "https://devnet.xrpl.org";

export interface NetworkConfig {
  wsUrl: string;
  faucetHost: string;
  /** Si défini, les comptes sont financés depuis ce wallet (nœud standalone sans faucet). */
  genesisSeed: string | undefined;
  walletsFile: string;
  /** Explorer du réseau, pour les liens affichés dans le front. */
  explorerUrl: string;
}

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

export function loadNetworkConfig(): NetworkConfig {
  return {
    wsUrl: readEnv("XRPL_WS") ?? DEFAULT_WS_URL,
    faucetHost: readEnv("XRPL_FAUCET_HOST") ?? DEFAULT_FAUCET_HOST,
    genesisSeed: readEnv("XRPL_GENESIS_SEED"),
    walletsFile: readEnv("XRPL_WALLETS_FILE") ?? DEFAULT_WALLETS_FILE,
    explorerUrl: readEnv("XRPL_EXPLORER_URL") ?? DEFAULT_EXPLORER_URL,
  };
}
