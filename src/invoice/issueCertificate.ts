// Création du certificat on-chain (IDEE §5 et §6) en un seul Batch tfAllOrNothing, soumis par la PME et
// co-signé par Bari : enregistrement de N → MPT facture avec la preuve → MPTokenAuthorize de Bari → transfert à Bari.
// Si N est déjà enregistré, le CredentialCreate interne échoue (tecDUPLICATE) et aucune des quatre
// transactions n'est appliquée : ni MPT, ni autorisation, ni transfert.

import type { Client, Wallet } from "xrpl";
import { log } from "../lib/logger.js";
import { BatchSequencer, readAllOrNothingOutcome, submitAllOrNothingBatch, type InnerTransaction } from "../xrpl/batch.js";
import { xrplLedger } from "../xrpl/ledger.js";
import { getMptIssuance } from "../xrpl/ledgerEntries.js";
import { createdMptIssuanceId } from "../xrpl/meta.js";
import type { InvoiceCertificate } from "./certificate.js";
import { invoiceTokenHandoverTxs, invoiceTokenId, invoiceTokenIssuanceTx } from "./invoiceToken.js";
import { getRegistration, nullifierRegistrationTx } from "./registry.js";

export interface IssuedCertificate {
  certificate: InvoiceCertificate;
  /** Identifiant du MPT facture. */
  tokenId: string;
}

export interface CertificateParties {
  sme: Wallet;
  bari: Wallet;
  registry: string;
}

/** Position du MPTokenIssuanceCreate dans le Batch. */
const ISSUANCE_INDEX = 1;

interface CertificateBatch {
  tokenId: string;
  inner: InnerTransaction[];
}

/** Les quatre transactions internes, séquences fixées : l'ID du MPT facture en dépend. */
async function buildCertificateBatch(
  sequencer: BatchSequencer,
  { sme, bari, registry }: CertificateParties,
  certificate: InvoiceCertificate,
): Promise<CertificateBatch> {
  const registration = nullifierRegistrationTx(sme.address, registry, certificate.nullifier);
  const registrationSequence = await sequencer.next(sme.address);
  const issuanceSequence = await sequencer.next(sme.address);
  const tokenId = invoiceTokenId(sme.address, issuanceSequence);
  const [authorize, payment] = invoiceTokenHandoverTxs(tokenId, sme.address, bari.address);
  const inner: InnerTransaction[] = [
    { tx: { ...registration, Sequence: registrationSequence }, label: "CredentialCreate registre N" },
    {
      tx: { ...invoiceTokenIssuanceTx(sme.address, certificate.metadataHex), Sequence: issuanceSequence },
      label: "MPTokenIssuanceCreate MPT facture",
    },
    { tx: { ...authorize, Sequence: await sequencer.next(bari.address) }, label: "MPTokenAuthorize bari (MPT facture)" },
    { tx: { ...payment, Sequence: await sequencer.next(sme.address) }, label: "Payment MPT facture sme → bari" },
  ];
  return { tokenId, inner };
}

/** Renvoie undefined si N est déjà enregistré : aucun MPT n'est alors émis ni transféré. */
export async function issueCertificate(
  client: Client,
  parties: CertificateParties,
  certificate: InvoiceCertificate,
): Promise<IssuedCertificate | undefined> {
  const { sme, bari, registry } = parties;
  log.info(`N = ${certificate.nullifier}`);
  log.info(`P = ${certificate.pseudonym}`);
  log.info(`C = ${certificate.commitment}`);
  const alreadyRegistered =
    (await getRegistration(xrplLedger(client), registry, sme.address, certificate.nullifier)) !== undefined;
  log.info(`registre (ledger_entry) : ${alreadyRegistered ? "N DÉJÀ PRÉSENT" : "N absent"}`);
  // Le Batch est soumis dans tous les cas : c'est son application, ordonnée par le consensus, qui fait foi.
  const sequencer = await BatchSequencer.open(client, sme.address);
  const { tokenId, inner } = await buildCertificateBatch(sequencer, parties, certificate);
  log.info(`ID du MPT facture calculé à l'avance : ${tokenId}`);
  const submission = await submitAllOrNothingBatch(client, sme, bari, sequencer, inner, "Batch certificat (tfAllOrNothing)");
  const applied = await readAllOrNothingOutcome(client, submission, inner);
  if (applied === undefined) {
    if ((await getMptIssuance(client, tokenId)) !== undefined) {
      throw new Error(`Batch ${submission.outcome.hash} rejeté mais le MPT ${tokenId} existe`);
    }
    log.info(`→ double financement bloqué par le ledger : Batch ${submission.outcome.hash} validé, aucune transaction interne appliquée`);
    log.info(`→ vérifié on-chain : aucun MPTokenIssuance à l'ID ${tokenId}`);
    return undefined;
  }
  const createdId = createdMptIssuanceId(applied[ISSUANCE_INDEX].meta);
  if (createdId !== tokenId) throw new Error(`ID du MPT facture inattendu : ${createdId} (calculé ${tokenId})`);
  log.info(`MPT facture ${tokenId} (preuve « ${certificate.proofSystem} » dans les métadonnées), remis à Bari`);
  return { certificate, tokenId };
}
