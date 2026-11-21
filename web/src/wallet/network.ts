// Réseau du wallet Otsu comparé à celui de l'API : Otsu ne donne que l'identifiant de son réseau courant.

import type { NetworkInfo } from "../../../src/api/contract";

export const OTSU_REPO_URL = "https://github.com/RomThpt/otsu-wallet";

/** Réseaux prédéfinis d'Otsu (`packages/constants/src/networks.ts`) ; un réseau ajouté à la main s'appelle `custom-…`. */
const OTSU_NETWORK_URLS: Readonly<Record<string, string>> = {
  mainnet: "wss://xrplcluster.com",
  testnet: "wss://s.altnet.rippletest.net:51233",
  devnet: "wss://s.devnet.rippletest.net:51233",
  alphanet: "wss://alphanet.nerdnest.xyz",
};
const CUSTOM_NETWORK_PREFIX = "custom-";

/** `custom` : réseau ajouté dans Otsu, dont l'URL n'est pas lisible ; la signature dira s'il connaît le compte. */
export type NetworkCheck = { kind: "match" } | { kind: "custom" } | { kind: "mismatch"; walletNetwork: string };

const normalizeUrl = (url: string) => url.trim().toLowerCase().replace(/\/+$/, "");

export function checkNetwork(walletNetwork: string, api: NetworkInfo): NetworkCheck {
  if (walletNetwork.startsWith(CUSTOM_NETWORK_PREFIX)) return { kind: "custom" };
  const url = OTSU_NETWORK_URLS[walletNetwork];
  return url !== undefined && normalizeUrl(url) === normalizeUrl(api.wsUrl) ? { kind: "match" } : { kind: "mismatch", walletNetwork };
}

/** Marche à suivre dans Otsu pour ajouter le réseau de Bari. */
export const addNetworkSteps = (wsUrl: string) => `Otsu → Settings → Networks → Add custom network → ${wsUrl}`;
