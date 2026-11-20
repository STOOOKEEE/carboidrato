// Factures attestées d'exemple pour la simulation du front (web/public/samples) : une valide, une falsifiée,
// une déjà enregistrée sur le ledger, une d'un débiteur hors liste. Réutilise les comptes de `npm run demo`.

import { mkdirSync, writeFileSync } from "node:fs";
import { Client } from "xrpl";
import { loadActors } from "../accounts/actors.js";
import { loadNetworkConfig } from "../config/network.js";
import { toAttestedInvoiceFile } from "../api/attestedInvoice.js";
import { ATTESTED_INVOICE_EXTENSION, type AttestedInvoiceFile } from "../api/contract.js";
import { VERIFIED_DEBTORS } from "../invoice/debtors.js";
import { registerNullifier } from "../invoice/registry.js";
import { eurToCents } from "../lib/amounts.js";
import { log } from "../lib/logger.js";
import { attestInvoice, deriveDebtor, invoiceNullifier, releaseZkResources, toHex32 } from "../zk/index.js";

const OUTPUT_DIR = new URL("../../web/public/samples/", import.meta.url);
const MS_PER_DAY = 86_400_000;
const MS_PER_SECOND = 1_000;
/** Débiteur fictif, absent de la liste vérifiée de Bari. */
const UNKNOWN_DEBTOR = "Edilizia Fantasma S.r.l.";
/** Montant affiché sur la facture falsifiée, alors que le débiteur a signé un montant dix fois plus petit. */
const FORGED_AMOUNT_FACTOR = 10n;

interface SampleSpec {
  file: string;
  debtorName: string;
  amountEur: number;
  termDays: number;
  description: string;
}

const SAMPLES = {
  valid: { file: "invoice-valid", debtorName: VERIFIED_DEBTORS[0].name, amountEur: 12_400, termDays: 90, description: "Road resurfacing, via Sparano (lot 2)" },
  forged: { file: "invoice-forged", debtorName: VERIFIED_DEBTORS[0].name, amountEur: 4_800, termDays: 60, description: "School roof repair" },
  financed: { file: "invoice-already-financed", debtorName: VERIFIED_DEBTORS[1].name, amountEur: 8_000, termDays: 120, description: "Public lighting maintenance" },
  unknownDebtor: { file: "invoice-unknown-debtor", debtorName: UNKNOWN_DEBTOR, amountEur: 25_000, termDays: 45, description: "Consulting services" },
} satisfies Record<string, SampleSpec>;

async function main(): Promise<void> {
  const network = loadNetworkConfig();
  const actors = loadActors(network);
  const client = new Client(network.wsUrl);
  await client.connect();
  try {
    const networkId = client.networkID;
    if (networkId === undefined) throw new Error("NetworkID du nœud inconnu");
    const runId = Date.now().toString(36).toUpperCase();
    const now = new Date();

    const attest = async (spec: SampleSpec) => {
      const number = `FT-2026/${runId}-${spec.file.toUpperCase()}`;
      const attestation = await attestInvoice(await deriveDebtor(spec.debtorName), {
        account: actors.sme.address,
        amount: eurToCents(spec.amountEur),
        dueDate: BigInt(Math.floor((now.getTime() + spec.termDays * MS_PER_DAY) / MS_PER_SECOND)),
        invoiceNumber: number,
        networkId,
        registry: actors.bari_registry.address,
      });
      const file = toAttestedInvoiceFile(
        { number, debtorName: spec.debtorName, description: spec.description, issueDate: now },
        attestation,
      );
      return { attestation, file };
    };

    const valid = await attest(SAMPLES.valid);
    const forged = await attest(SAMPLES.forged);
    forged.file.attestation.amountCents = (forged.attestation.amount * FORGED_AMOUNT_FACTOR).toString();
    const financed = await attest(SAMPLES.financed);
    const nullifier = toHex32(await invoiceNullifier(financed.attestation.uuid));
    await registerNullifier(client, actors.sme, actors.bari_registry.address, nullifier);
    const unknownDebtor = await attest(SAMPLES.unknownDebtor);

    mkdirSync(OUTPUT_DIR, { recursive: true });
    const outputs: [SampleSpec, AttestedInvoiceFile][] = [
      [SAMPLES.valid, valid.file],
      [SAMPLES.forged, forged.file],
      [SAMPLES.financed, financed.file],
      [SAMPLES.unknownDebtor, unknownDebtor.file],
    ];
    for (const [spec, file] of outputs) {
      const target = new URL(`${spec.file}${ATTESTED_INVOICE_EXTENSION}`, OUTPUT_DIR);
      writeFileSync(target, `${JSON.stringify(file, null, 2)}\n`);
      log.info(`écrit ${target.pathname}`);
    }
  } finally {
    await client.disconnect();
    await releaseZkResources();
  }
}

await main();
