// `npm run audit -- <ID du Vault ou du LoanBroker>` : audit public du fonds depuis le ledger seul.

import { Client } from "xrpl";
import { loadNetworkConfig } from "../config/network.js";
import { log } from "../lib/logger.js";
import { auditFund } from "./auditFund.js";
import { releaseZkResources } from "../zk/index.js";

const LEDGER_ID_PATTERN = /^[0-9A-Fa-f]{64}$/;

async function main(): Promise<void> {
  const id = process.argv[2];
  if (id === undefined || !LEDGER_ID_PATTERN.test(id)) {
    throw new Error("Usage : npm run audit -- <ID du Vault ou du LoanBroker (64 caractères hex)>");
  }
  const client = new Client(loadNetworkConfig().wsUrl);
  await client.connect();
  try {
    log.step(`Audit du fonds ${id.toUpperCase()}`);
    const { anomalies } = await auditFund(client, id.toUpperCase());
    if (anomalies > 0) process.exitCode = 1;
  } finally {
    await client.disconnect();
    await releaseZkResources();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
