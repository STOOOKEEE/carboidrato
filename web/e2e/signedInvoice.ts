// Facture attestée pour les e2e, signée ici comme dans le navigateur de l'organisme public (clés dérivées du secret
// public de démo) : le serveur de Bari ne signe plus de facture.

import { toAttestedInvoiceFile } from "../../src/api/attestedInvoice";
import type { AttestedInvoiceFile, ProofParams } from "../../src/api/contract";
import { attestInvoice, deriveDebtor } from "../../src/zk/index";

const MS_PER_SECOND = 1_000;
const CENTS_PER_EUR = 100;

export interface InvoiceSpec {
  /** Numéro unique : les factures du pitch ne sont jamais financées par un test. */
  number: string;
  debtorName: string;
  supplierAccount: string;
  amountEur: number;
  dueDate: Date;
}

export async function signedInvoice(spec: InvoiceSpec, params: ProofParams): Promise<AttestedInvoiceFile> {
  const attestation = await attestInvoice(await deriveDebtor(spec.debtorName), {
    account: spec.supplierAccount,
    amount: BigInt(Math.round(spec.amountEur * CENTS_PER_EUR)),
    dueDate: BigInt(Math.floor(spec.dueDate.getTime() / MS_PER_SECOND)),
    invoiceNumber: spec.number.trim().toUpperCase().replace(/\s+/g, ""),
    networkId: params.networkId,
    registry: params.registry,
  });
  return toAttestedInvoiceFile(
    { number: spec.number, debtorName: spec.debtorName, description: "Road maintenance", issueDate: new Date() },
    attestation,
  );
}
