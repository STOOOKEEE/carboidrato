// Pré-contrôle d'une facture attestée (simulation de la landing) : les contrôles que Bari refait avant de
// co-signer, sans preuve ni transaction. Authenticité (signature du débiteur), débiteur vérifié (Merkle),
// bon réseau et bon registre, échéance future, unicité (N absent du registre on-chain), puis l'offre.

import type { Client } from "xrpl";
import { verifiedDebtorList } from "../invoice/certificate.js";
import { getRegistration } from "../invoice/registry.js";
import { isSmeKybDone } from "../kyb/smeKyb.js";
import { CENTS_PER_EUR } from "../lib/amounts.js";
import { debtorLeaf, invoiceNullifier, toHex32, verifyAttestation } from "../zk/index.js";
import { toCircuitAttestation } from "./attestedInvoice.js";
import { CHECK_IDS, type AttestedInvoiceFile, type CheckId, type PrecheckResponse } from "./contract.js";
import { buildOffer, daysUntil } from "./offer.js";

const MS_PER_SECOND = 1_000;

export interface LedgerContext {
  client: Client;
  registry: string;
  kybIssuer: string;
}

export async function precheckInvoice(
  file: AttestedInvoiceFile,
  ledger: LedgerContext,
  now: Date = new Date(),
): Promise<PrecheckResponse> {
  const attestation = toCircuitAttestation(file);
  const { account, registry, networkId } = file.attestation;
  const nullifier = toHex32(await invoiceNullifier(attestation.uuid));
  const dueDateSeconds = Number(attestation.dueDate);
  const termDays = daysUntil(dueDateSeconds, Math.floor(now.getTime() / MS_PER_SECOND));

  const [signatureOk, debtors, leaf, registration, kybDone] = await Promise.all([
    verifyAttestation(attestation),
    verifiedDebtorList(),
    debtorLeaf(attestation.debtorPublicKey),
    getRegistration(ledger.client, ledger.registry, account, nullifier),
    isSmeKybDone(ledger.client, account, ledger.kybIssuer),
  ]);

  const outcomes: Record<CheckId, boolean> = {
    signature: signatureOk,
    debtor: debtors.levels[0].includes(leaf),
    network: networkId === ledger.client.networkID && registry === ledger.registry,
    dueDate: termDays > 0,
    unique: registration === undefined,
  };
  const checks = CHECK_IDS.map((id) => ({ id, ok: outcomes[id] }));
  const eligible = checks.every((check) => check.ok);
  const amountCents = Number(attestation.amount);

  return {
    verdict: eligible ? "eligible" : "rejected",
    invoice: {
      number: file.invoice.number,
      debtorName: file.invoice.debtorName,
      amountEur: amountCents / CENTS_PER_EUR,
      dueDate: new Date(dueDateSeconds * MS_PER_SECOND).toISOString(),
    },
    checks,
    kyb: { account, done: kybDone },
    nullifier,
    ...(eligible ? { offer: buildOffer(amountCents, termDays) } : {}),
  };
}
