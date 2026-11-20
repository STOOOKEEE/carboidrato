// API du front (web/) : pré-contrôle d'une facture attestée et KYB de la PME, sur le réseau de la démo.
// Réutilise les comptes créés par `npm run demo` (aucune création ni financement ici).

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Client, isValidClassicAddress } from "xrpl";
import { loadActors, type Actors } from "../accounts/actors.js";
import { loadNetworkConfig } from "../config/network.js";
import { isSmeKybDone, onboardSme } from "../kyb/smeKyb.js";
import { parseAttestedInvoice, InvalidInvoiceFile } from "./attestedInvoice.js";
import type { KybRequest, KybResponse } from "./contract.js";
import { HttpError, readJsonBody, sendJson } from "./http.js";
import { precheckInvoice } from "./precheck.js";

const DEFAULT_PORT = 8787;

const network = loadNetworkConfig();
const actors: Actors = loadActors(network);
const client = new Client(network.wsUrl);

async function connectedClient(): Promise<Client> {
  if (!client.isConnected()) await client.connect();
  return client;
}

async function handleCheck(request: IncomingMessage) {
  const file = parseAttestedInvoice(await readJsonBody(request));
  return precheckInvoice(file, {
    client: await connectedClient(),
    registry: actors.bari_registry.address,
    kybIssuer: actors.kyb_issuer.address,
  });
}

function parseKybRequest(body: unknown): KybRequest {
  if (typeof body !== "object" || body === null) throw new HttpError(400, "Invalid request");
  const { account, company, vatNumber } = body as Record<string, unknown>;
  if (typeof account !== "string" || !isValidClassicAddress(account)) throw new HttpError(400, "Invalid XRPL address");
  if (typeof company !== "string" || company.trim() === "") throw new HttpError(400, "Company name is required");
  if (typeof vatNumber !== "string" || vatNumber.trim() === "") throw new HttpError(400, "VAT number is required");
  return { account, company, vatNumber };
}

/** KYB simulé : le prestataire émet KYB_PME, accepté par la PME. Seule la PME de la démo a une clé côté serveur. */
async function handleKyb(request: IncomingMessage): Promise<KybResponse> {
  const { account } = parseKybRequest(await readJsonBody(request));
  if (account !== actors.sme.address) {
    throw new HttpError(403, "On this devnet demo, only the demo SME account can be onboarded");
  }
  const ledger = await connectedClient();
  if (!(await isSmeKybDone(ledger, account, actors.kyb_issuer.address))) await onboardSme(ledger, actors);
  return { account, done: true, explorerUrl: `${network.explorerUrl}/accounts/${account}` };
}

const ROUTES: Record<string, (request: IncomingMessage) => Promise<unknown>> = {
  "POST /api/check": handleCheck,
  "POST /api/kyb": handleKyb,
};

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const route = ROUTES[`${request.method} ${request.url}`];
  if (route === undefined) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }
  try {
    sendJson(response, 200, await route(request));
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(response, error.status, { error: error.message });
    } else if (error instanceof InvalidInvoiceFile) {
      sendJson(response, 422, { error: `Not an attested invoice: ${error.message}` });
    } else {
      console.error(error);
      sendJson(response, 500, { error: "Ledger or server error, please retry" });
    }
  }
}

const port = Number(process.env.API_PORT ?? DEFAULT_PORT);
createServer((request, response) => void handle(request, response)).listen(port, () => {
  console.log(`API Bari sur http://localhost:${port} (ledger ${network.wsUrl})`);
});
