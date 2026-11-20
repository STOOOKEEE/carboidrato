// Production du certificat d'une facture (IDEE §5, étapes 1 et 2) : la mairie atteste la facture (EdDSA sur
// BabyJubJub), la PME prouve l'énoncé du §7.3 (Groth16), et la preuve devient les métadonnées du MPT facture.

import {
  attestInvoice,
  buildDebtorList,
  deriveDebtor,
  merklePath,
  prove,
  statementHex,
  toHex32,
  type DebtorList,
} from "../zk/index.js";
import { eurToCents } from "../lib/amounts.js";
import { encodeCertificateMetadata, GROTH16_PROOF_SYSTEM } from "./certificateMetadata.js";
import { VERIFIED_DEBTORS } from "./debtors.js";
import { normalizeInvoiceNumber, type Invoice } from "./invoice.js";

const MS_PER_SECOND = 1_000;

export interface CertificateRequest {
  invoice: Invoice;
  /** Compte XRPL de la PME (lie la preuve à son propriétaire). */
  smeAccount: string;
  /** Compte registre de Bari. */
  registry: string;
  networkId: number;
  vintage: number;
  /** Montant minimal prouvé (la facture vaut au moins ce seuil). */
  thresholdEur: number;
}

export interface InvoiceCertificate {
  /** Empreinte N (32 octets hex) : CredentialType du registre et Data du prêt. */
  nullifier: string;
  /** Pseudonyme P du débiteur (32 octets hex), propre au millésime. */
  pseudonym: string;
  /** Engagement C (32 octets hex), révélable en cas de litige. */
  commitment: string;
  merkleRoot: string;
  proofSystem: string;
  /** MPTokenMetadata du MPT facture, prêt à soumettre (≤ 1024 octets). */
  metadataHex: string;
}

let debtorList: Promise<DebtorList> | undefined;

/** Liste Merkle des débiteurs vérifiés par Bari (calculée une fois par exécution). */
export function verifiedDebtorList(): Promise<DebtorList> {
  debtorList ??= Promise.all(VERIFIED_DEBTORS.map(async (debtor) => (await deriveDebtor(debtor.name)).publicKey)).then(
    buildDebtorList,
  );
  return debtorList;
}

/** Racine de la liste des débiteurs vérifiés, publiée on-chain dans le Data du Vault. */
export async function verifiedDebtorsRoot(): Promise<string> {
  return toHex32((await verifiedDebtorList()).root);
}

export async function produceInvoiceCertificate(request: CertificateRequest): Promise<InvoiceCertificate> {
  const { invoice } = request;
  const debtor = await deriveDebtor(invoice.debtor.name);
  const attestation = await attestInvoice(debtor, {
    account: request.smeAccount,
    amount: eurToCents(invoice.amountEur),
    dueDate: BigInt(Math.floor(invoice.dueDate.getTime() / MS_PER_SECOND)),
    invoiceNumber: normalizeInvoiceNumber(invoice),
    networkId: request.networkId,
    registry: request.registry,
  });
  const list = await verifiedDebtorList();
  const proven = await prove({
    attestation,
    merklePath: await merklePath(list, debtor.publicKey),
    debtorsRoot: list.root,
    threshold: eurToCents(request.thresholdEur),
    vintage: BigInt(request.vintage),
  });
  return {
    ...statementHex(proven.statement),
    proofSystem: GROTH16_PROOF_SYSTEM,
    metadataHex: encodeCertificateMetadata(proven),
  };
}
