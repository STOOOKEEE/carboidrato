// `npm run api:smoke` : parcours complet contre l'API du fonds déjà démarrée (npm run api:fund avec
// BARI_STATE_FILE=/tmp/…), comme le front : fonds et souscription des investisseurs de démo → inscription d'une
// entreprise (cookie de session) → attestation signée localement pour son compte → preuve calculée côté client au palier
// de la facture → certificat → prêt → rejeu refusé (409) → audit → remboursement par le compte de l'entreprise.
// SMOKE_DUMP_FILE=<fichier> enregistre toutes les réponses (exemples pour le front).

import { groth16 } from "snarkjs";
import { CENTS_PER_EUR, eurToCents } from "../../../lib/amounts.js";
import { log } from "../../../lib/logger.js";
import { attestInvoice, deriveDebtor, fromHex, PUBLIC_SIGNAL_ORDER, releaseZkResources } from "../../../zk/index.js";
import { parseAttestedInvoice, toAttestedInvoiceFile } from "../../attestedInvoice.js";
import { buildProveInput, toCircuitInput, type ProofExpectations } from "../zkInputs.js";
import { ApiClient, field, stringField } from "./http.js";
import { EventCounter } from "./sse.js";

const DEFAULT_API_URL = "http://127.0.0.1:8788";
/** Facture de 23 450 € : prouvée au palier de 20 000 €, avance de 18 000 € (sous la limite de concentration). */
const INVOICE_AMOUNT_EUR = 23_450;
const EXPECTED_THRESHOLD_CENTS = "2000000";
const EXPECTED_PRINCIPAL_UNITS = "18000000000";
const INVOICE_TERM_DAYS = 90;
const MS_PER_DAY = 86_400_000;
const MS_PER_SECOND = 1_000;
const HTTP_CONFLICT = 409;
const DEMO_DEBTOR = "Comune di Bari";
const PASSWORD = "correct horse battery";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Échec du smoke test : ${message}`);
}

function logTransactions(response: unknown): void {
  const transactions = field(response, "transactions");
  if (!Array.isArray(transactions)) throw new Error("Liste des transactions illisible");
  for (const tx of transactions) log.info(`  ${stringField(tx, "label")} ${stringField(tx, "hash")} ${stringField(tx, "result")}`);
}

/** Entreprise inscrite par l'API, avec un n° de TVA unique : le client garde son cookie de session. */
async function signUpBusiness(api: ApiClient, unique: string): Promise<string> {
  const signup = await api.call("POST", "/api/auth/signup", {
    email: `smoke-${unique}@smoke.example`,
    password: PASSWORD,
    role: "business",
    profile: { company: `Smoke Forniture ${unique} S.r.l.`, vatNumber: `IT${unique}` },
  });
  const address = stringField(field(signup, "user"), "address");
  log.info(`entreprise inscrite, compte géré ${address}`);
  logTransactions(signup);
  return address;
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
  log.step("Fonds · comptes, création (RLUSD, KYC, domaine, Vault + broker, souscription des investisseurs de démo)");
  const created = await api.call("POST", "/api/fund", { replace: true });
  const vaultId = stringField(field(field(created, "fund"), "cohort"), "vaultId");
  log.info(`Vault ${vaultId}`);

  log.step("Entreprise · inscription (compte géré, KYB émis par Bari, ligne de confiance RLUSD)");
  const runId = Date.now();
  const businessAccount = await signUpBusiness(api, String(runId));

  log.step("Organisme public · attestation signée localement ; entreprise · entrée du circuit et preuve côté client");
  const path = await api.call("GET", `/api/debtors/path?debtor=${encodeURIComponent(DEMO_DEBTOR)}`);
  const fund = await api.call("GET", "/api/fund");
  const debtorsRoot = stringField(field(fund, "manifest"), "debtorsRoot");
  assert(stringField(path, "rootHex") === debtorsRoot, "racine Merkle ≠ fiche du fonds");
  const params = await api.call("GET", "/api/proof/params");
  const expected: ProofExpectations = {
    smeAccount: businessAccount,
    registry: stringField(params, "registry"),
    networkId: Number(field(params, "networkId")),
    debtorsRoot: fromHex(debtorsRoot),
    vintage: BigInt(Number(field(params, "vintage"))),
  };
  const invoiceNumber = `FT-SMOKE/${runId.toString(36)}`;
  const dueDate = new Date(Date.now() + INVOICE_TERM_DAYS * MS_PER_DAY);
  const attested = toAttestedInvoiceFile(
    { number: invoiceNumber, debtorName: DEMO_DEBTOR, description: "Smoke test", issueDate: new Date() },
    await attestInvoice(await deriveDebtor(DEMO_DEBTOR), {
      account: businessAccount,
      amount: eurToCents(INVOICE_AMOUNT_EUR),
      dueDate: BigInt(Math.floor(dueDate.getTime() / MS_PER_SECOND)),
      invoiceNumber,
      networkId: expected.networkId,
      registry: expected.registry,
    }),
  );
  const artifacts = await Promise.all([api.bytes("/api/zk/bari_invoice.wasm"), api.bytes("/api/zk/bari_invoice_final.zkey")]);
  const proof = await proveLikeBrowser(attested, expected, artifacts);
  const threshold = proof.publicSignals[PUBLIC_SIGNAL_ORDER.indexOf("threshold")];
  assert(threshold === EXPECTED_THRESHOLD_CENTS, `palier prouvé ${threshold} ≠ ${EXPECTED_THRESHOLD_CENTS}`);
  assert(!proof.publicSignals.includes(attested.attestation.amountCents), "le montant exact figure dans les signaux publics");
  log.info(`facture de ${INVOICE_AMOUNT_EUR} € prouvée au palier de ${Number(threshold) / CENTS_PER_EUR} €`);

  log.step("Certificat puis prêt co-signé, avec la session de l'entreprise");
  const certificate = await api.call("POST", "/api/sme/certificate", proof);
  const tokenId = stringField(certificate, "tokenId");
  logTransactions(certificate);
  const loan = await api.call("POST", "/api/sme/loan", { tokenId });
  const loanId = stringField(loan, "loanId");
  assert(stringField(loan, "principal") === EXPECTED_PRINCIPAL_UNITS, `principal ${stringField(loan, "principal")} ≠ 18 000 €`);
  log.info(`prêt ${loanId} : LoanSet ${stringField(loan, "txHash")}`);

  log.step("Rejeu du même certificat");
  const replay = await api.call("POST", "/api/sme/certificate", proof, [HTTP_CONFLICT]);
  log.info(`rejeu refusé (409) : ${stringField(field(replay, "rejectedBy"), "label")} ${stringField(replay, "hash")}`);

  log.step("Audit");
  const audit = await api.call("GET", "/api/audit");
  assert(field(audit, "anomalies") === 0, "anomalies à l'audit");
  assert(field(audit, "verifiedProofs") === 1 && field(audit, "loans") === 1, "preuve non vérifiée à l'audit");

  log.step("Remboursement par le compte de l'entreprise");
  const repaid = await api.call("POST", `/api/loans/${loanId}/repay`);
  logTransactions(repaid);

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
