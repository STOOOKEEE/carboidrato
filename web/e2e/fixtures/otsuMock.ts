// Faux Otsu pour les e2e : `window.xrpl` (`isOtsu: true`) injecté dans la page, chaque appel exécuté dans Node comme
// le fait l'extension (compte actif en `Account`, autofill sur le réseau du wallet, signature avec @xrpl-commons/xrpl).

import type { Page } from "@playwright/test";
import { Client, Wallet, type SubmittableTransaction } from "@xrpl-commons/xrpl";

const DEFAULT_WS_URL = "wss://s.devnet.rippletest.net:51233";
/** Réseaux prédéfinis d'Otsu ; un autre nœud y est un réseau ajouté à la main (`custom-<horodatage>`). */
const OTSU_NETWORKS: Readonly<Record<string, string>> = {
  "wss://xrplcluster.com": "mainnet",
  "wss://s.altnet.rippletest.net:51233": "testnet",
  "wss://s.devnet.rippletest.net:51233": "devnet",
  "wss://alphanet.nerdnest.xyz": "alphanet",
};
const BRIDGE = "__otsuRequest";

export interface OtsuMock {
  wallet: Wallet;
  close(): Promise<void>;
}

/** À appeler avant `page.goto` : le wallet est neuf (inconnu du ledger et de Bari) sauf s'il est fourni. */
export async function installOtsuMock(page: Page, wallet: Wallet = Wallet.generate()): Promise<OtsuMock> {
  const wsUrl = process.env.XRPL_WS?.trim() || DEFAULT_WS_URL;
  const network = OTSU_NETWORKS[wsUrl.replace(/\/+$/, "")] ?? `custom-${Date.now()}`;
  const client = new Client(wsUrl);
  await client.connect();

  await page.exposeFunction(BRIDGE, async (method: string, params: Record<string, unknown> | undefined) => {
    switch (method) {
      case "connect":
      case "getAddress":
        return { address: wallet.address };
      case "getNetwork":
        return { network };
      case "signTransaction": {
        const tx = { ...params, Account: wallet.address } as SubmittableTransaction;
        const prepared = await client.prepareTransaction(tx);
        const { tx_blob, hash } = wallet.sign(prepared);
        return { tx_blob, hash };
      }
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  });

  await page.addInitScript((bridge) => {
    const call = (method: string, params?: unknown) =>
      (window as unknown as Record<string, (method: string, params?: unknown) => Promise<unknown>>)[bridge](method, params);
    Object.assign(window, {
      xrpl: {
        isOtsu: true,
        connect: () => call("connect"),
        getAddress: () => call("getAddress"),
        getNetwork: () => call("getNetwork"),
        signTransaction: (tx: Record<string, unknown>) => call("signTransaction", tx),
      },
    });
  }, BRIDGE);

  return { wallet, close: () => client.disconnect() };
}
