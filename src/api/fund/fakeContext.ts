// Contexte de l'API sans réseau pour les tests de routes (app.inject) : faux Ledger, état et comptes en fichiers temporaires.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, Wallet } from "xrpl";
import { ACTOR_NAMES, type Actors } from "../../accounts/actors.js";
import { UserStore } from "../../accounts/userStore.js";
import type { NetworkConfig } from "../../config/network.js";
import { FakeLedger } from "../../xrpl/fakeLedger.js";
import type { ApiConfig } from "./config.js";
import type { ApiContext } from "./context.js";
import { EventHub } from "./events.js";
import { OperationQueue } from "./operations.js";
import { FundStateStore } from "./stateStore.js";

const NETWORK_ID = 1000;

const fakeNetwork: NetworkConfig = {
  wsUrl: "wss://alphanet.example",
  faucetHost: "",
  genesisSeed: undefined,
  walletsFile: ".wallets.alphanet.json",
  explorerUrl: "https://devnet.xrpl.org",
  hasExplorer: false,
  rlusdIssuer: undefined,
};

export const fakeApiConfig: ApiConfig = { host: "127.0.0.1", port: 0, corsOrigins: [], stateFile: "", usersFile: "" };

export function fakeContext(overrides: Partial<ApiContext> = {}): ApiContext {
  const directory = mkdtempSync(join(tmpdir(), "bari-api-"));
  const events = new EventHub(fakeNetwork.explorerUrl);
  return {
    client: new Client(fakeNetwork.wsUrl),
    ledger: new FakeLedger(NETWORK_ID),
    network: fakeNetwork,
    actors: Object.fromEntries(ACTOR_NAMES.map((name) => [name, Wallet.generate()])) as Actors,
    store: new FundStateStore(join(directory, "state.json")),
    users: new UserStore(join(directory, "users.json")),
    provisionAccount: async () => undefined,
    events,
    operations: new OperationQueue(events),
    activateWallet: async () => undefined,
    ...overrides,
  };
}
