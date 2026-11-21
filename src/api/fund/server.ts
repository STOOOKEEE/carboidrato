// `npm run api:fund` : serveur HTTP du fonds pour le front (mode démo : il détient les wallets des acteurs et
// signe pour eux). Écoute sur 127.0.0.1 ; l'état du fonds courant est persisté dans un fichier gitignoré.

import { Client } from "xrpl";
import { ensureActors } from "../../accounts/actors.js";
import { makeProvisioner } from "../../accounts/provisioning.js";
import { UserStore } from "../../accounts/userStore.js";
import { loadNetworkConfig } from "../../config/network.js";
import { log } from "../../lib/logger.js";
import { xrplLedger } from "../../xrpl/ledger.js";
import { releaseZkResources } from "../../zk/index.js";
import { buildApp } from "./app.js";
import { loadApiConfig } from "./config.js";
import { EventHub } from "./events.js";
import { OperationQueue } from "./operations.js";
import { FundStateStore } from "./stateStore.js";

const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;

async function main(): Promise<void> {
  const network = loadNetworkConfig();
  const config = loadApiConfig(network);
  const client = new Client(network.wsUrl);
  await client.connect();

  log.step(`Comptes de démo (${network.walletsFile})`);
  const actors = await ensureActors(client, network);
  const store = new FundStateStore(config.stateFile);
  const events = new EventHub(network.explorerUrl);
  const app = await buildApp(config, {
    client,
    ledger: xrplLedger(client),
    network,
    actors,
    store,
    events,
    operations: new OperationQueue(events),
    users: new UserStore(config.usersFile),
    provisionAccount: makeProvisioner(client, network),
  });
  app.addHook("onClose", async () => {
    events.close();
    await client.disconnect();
    await releaseZkResources();
  });

  for (const signal of SHUTDOWN_SIGNALS) {
    process.once(signal, () => {
      log.info(`${signal} : arrêt du serveur`);
      app.close().catch((error: unknown) => {
        log.warn(`arrêt incomplet : ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      });
    });
  }

  await app.listen({ host: config.host, port: config.port });
  const current = store.current;
  log.step(`API du fonds sur http://${config.host}:${config.port} (ledger ${network.wsUrl})`);
  log.info(`état : ${config.stateFile} (${current === undefined ? "aucun fonds" : `Vault ${current.fund.cohort.vaultId}`})`);
  log.info(`CORS : ${config.corsOrigins.join(", ")}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
