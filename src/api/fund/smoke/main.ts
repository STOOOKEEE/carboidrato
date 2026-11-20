// `npm run api:smoke` : parcours complet contre l'API du fonds déjà démarrée (npm run api:fund), comme le ferait
// le front : fonds → dépôts → KYB → attestation → entrée du circuit construite ici (jamais par l'API) → preuve
// calculée côté client avec snarkjs et les artefacts servis par l'API → certificat → rejeu refusé (409) → prêt →
// audit → remboursement → rachat.
// SMOKE_DUMP_FILE=<fichier> enregistre toutes les réponses (exemples pour le front).

import { groth16 } from "snarkjs";
import { log } from "../../../lib/logger.js";
import { fromHex, releaseZkResources } from "../../../zk/index.js";
import { parseAttestedInvoice } from "../../attestedInvoice.js";
import { buildProveInput, toCircuitInput, type ProofExpectations } from "../zkInputs.js";
import { ApiClient, field, stringField } from "./http.js";
import { EventCounter } from "./sse.js";

const DEFAULT_API_URL = "http://127.0.0.1:8788";
const INVOICE_AMOUNT_EUR = 10_000;
const INVOICE_TERM_DAYS = 90;
const MS_PER_DAY = 86_400_000;
const HTTP_CONFLICT = 409;
const DEMO_DEBTOR = "Comune di Bari";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Échec du smoke test : ${message}`);
}

/** Côté navigateur : entrée du circuit construite localement, puis preuve Groth16 calculée localement. */
async function proveLikeBrowser(attested: unknown, expected: ProofExpectations, artifacts: Uint8Array[]) {
  const input = toCircuitInput(await buildProveInput(parseAttestedInvoice(attested), expected));
  const startedAt = performance.now();
  const [wasm, zkey] = artifacts;
  const proof = await groth16.fullProve(input, wasm, zkey);
  log.info(`preuve calculée côté client en ${Math.round(performance.now() - startedAt)} ms`);
  return proof;
}

async function run(api: ApiClient, events: EventCounter): Promise<void> {
  log.step("Fonds · comptes, création (stablecoin, KYC, domaine, Vault + broker)");
  const actors = await api.call("GET", "/api/actors");
  if (!Array.isArray(actors)) throw new Error("Liste des acteurs illisible");
  const sme = actors.find((actor) => field(actor, "name") === "sme");
  const smeAccount = stringField(sme, "address");
  const created = await api.call("POST", "/api/fund", { replace: true });
  const vaultId = stringField(field(field(created, "fund"), "cohort"), "vaultId");
  log.info(`Vault ${vaultId}`);

  log.step("Souscription et KYB");
  await api.call("POST", "/api/investors/deposit");
  await api.call("POST", "/api/sme/kyb", { account: smeAccount, company: "Marco Costruzioni S.r.l.", vatNumber: "IT01234567890" });

  log.step("Mairie · attestation ; PME · entrée du circuit et preuve côté client");
  const invoice = {
    invoiceNumber: `FT-SMOKE/${Date.now().toString(36)}`,
    amountEur: INVOICE_AMOUNT_EUR,
    dueDate: new Date(Date.now() + INVOICE_TERM_DAYS * MS_PER_DAY).toISOString(),
    smeAccount,
  };
  const attested = await api.call("POST", "/api/debtor/attest", invoice);
  const path = await api.call("GET", `/api/debtors/path?debtor=${encodeURIComponent(DEMO_DEBTOR)}`);
  const fund = await api.call("GET", "/api/fund");
  const debtorsRoot = stringField(field(fund, "manifest"), "debtorsRoot");
  assert(stringField(path, "rootHex") === debtorsRoot, "racine Merkle ≠ fiche du fonds");
  const params = await api.call("GET", "/api/proof/params");
  const expected: ProofExpectations = {
    smeAccount,
    registry: stringField(params, "registry"),
    networkId: Number(field(params, "networkId")),
    debtorsRoot: fromHex(debtorsRoot),
    vintage: BigInt(Number(field(params, "vintage"))),
  };
  const artifacts = await Promise.all([api.bytes("/api/zk/bari_invoice.wasm"), api.bytes("/api/zk/bari_invoice_final.zkey")]);
  const proof = await proveLikeBrowser(attested, expected, artifacts);

  log.step("Certificat, puis rejeu de la même facture");
  const certificate = await api.call("POST", "/api/sme/certificate", proof);
  const tokenId = stringField(certificate, "tokenId");
  const reattested = await api.call("POST", "/api/debtor/attest", invoice);
  const replayProof = await proveLikeBrowser(reattested, expected, artifacts);
  const replay = await api.call("POST", "/api/sme/certificate", replayProof, [HTTP_CONFLICT]);
  log.info(`rejeu refusé (409) : ${stringField(field(replay, "rejectedBy"), "label")} ${stringField(replay, "hash")}`);

  log.step("Prêt co-signé, audit");
  const loan = await api.call("POST", "/api/sme/loan", { tokenId });
  const loanId = stringField(loan, "loanId");
  const audit = await api.call("GET", "/api/audit");
  assert(field(audit, "anomalies") === 0, "anomalies à l'audit");
  assert(field(audit, "verifiedProofs") === 1 && field(audit, "loans") === 1, "preuve non vérifiée à l'audit");

  log.step("Remboursement et rachat");
  await api.call("POST", `/api/loans/${loanId}/repay`);
  await api.call("POST", "/api/investors/redeem");

  const transactions = events.counts.get("tx") ?? 0;
  log.info(`SSE : ${events.total()} événements (${[...events.counts].map(([type, count]) => `${type} ${count}`).join(", ")})`);
  assert(transactions > 0, "aucune transaction reçue sur le flux SSE");
  log.step("Smoke test réussi");
}

async function main(): Promise<void> {
  const api = new ApiClient(process.env.API_URL ?? DEFAULT_API_URL);
  const events = new EventCounter();
  await events.connect(`${api.baseUrl}/api/events`);
  try {
    await run(api, events);
  } finally {
    await events.close();
    await releaseZkResources();
    const dumpFile = process.env.SMOKE_DUMP_FILE;
    if (dumpFile !== undefined) api.dump(dumpFile);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
