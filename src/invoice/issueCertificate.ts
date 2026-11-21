// Création du certificat on-chain (IDEE §5 et §6) en un seul Batch tfAllOrNothing, soumis par la PME et
// co-signé par Bari : enregistrement de N → MPT facture avec la preuve → MPTokenAuthorize de Bari → transfert à Bari.
// Si N est déjà enregistré, le CredentialCreate interne échoue (tecDUPLICATE) et aucune des quatre
// transactions n'est appliquée : ni MPT, ni autorisation, ni transfert. Compte géré : Bari signe pour la PME ;
// wallet : Bari prépare et co-signe le Batch, la PME le signe dans son wallet.

import { signMultiBatch, type Batch, type Client, type Wallet } from "xrpl";
import { log } from "../lib/logger.js";
import {
  allOrNothingBatch,
  BatchSequencer,
  COSIGNER_SIGNATURES,
  innerHashesOf,
  readAllOrNothingOutcome,
  submitAllOrNothingBatch,
  type InnerTransaction,
} from "../xrpl/batch.js";
import { xrplLedger, type Ledger } from "../xrpl/ledger.js";
import { createdMptIssuanceId } from "../xrpl/meta.js";
import { SIGNING_WINDOW_LEDGERS, type WalletTxPorts } from "../xrpl/preparedTx.js";
import type { TxOutcome } from "../xrpl/submit.js";
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

/** Libellé du Batch du certificat (le front ouvre la transaction dont le libellé commence par « Batch »). */
export const CERTIFICATE_BATCH_LABEL = "Batch certificat (tfAllOrNothing)";

/** Position du MPTokenIssuanceCreate dans le Batch. */
const ISSUANCE_INDEX = 1;

interface CertificateBatch {
  tokenId: string;
  inner: InnerTransaction[];
}

/** Batch complété et co-signé par Bari, à signer par le wallet de l'entreprise (compte externe du Batch). */
export interface PreparedCertificate extends CertificateBatch {
  batch: Batch;
  innerHashes: string[];
}

/** Les quatre transactions internes, séquences fixées : l'ID du MPT facture en dépend. */
async function buildCertificateBatch(
  sequencer: BatchSequencer,
  { sme, bari, registry }: { sme: string; bari: string; registry: string },
  certificate: InvoiceCertificate,
): Promise<CertificateBatch> {
  const registration = nullifierRegistrationTx(sme, registry, certificate.nullifier);
  const registrationSequence = await sequencer.next(sme);
  const issuanceSequence = await sequencer.next(sme);
  const tokenId = invoiceTokenId(sme, issuanceSequence);
  const [authorize, payment] = invoiceTokenHandoverTxs(tokenId, sme, bari);
  const inner: InnerTransaction[] = [
    { tx: { ...registration, Sequence: registrationSequence }, label: "CredentialCreate registre N" },
    {
      tx: { ...invoiceTokenIssuanceTx(sme, certificate.metadataHex), Sequence: issuanceSequence },
      label: "MPTokenIssuanceCreate MPT facture",
    },
    { tx: { ...authorize, Sequence: await sequencer.next(bari) }, label: "MPTokenAuthorize bari (MPT facture)" },
    { tx: { ...payment, Sequence: await sequencer.next(sme) }, label: "Payment MPT facture sme → bari" },
  ];
  return { tokenId, inner };
}

/**
 * Lit l'application d'un Batch du certificat validé : le certificat si tout est appliqué, undefined si rien ne l'est
 * (N déjà enregistré).
 */
export async function settleCertificateBatch(
  ledger: Ledger,
  { tokenId, inner, innerHashes }: CertificateBatch & { innerHashes: string[] },
  outcome: TxOutcome,
  certificate: InvoiceCertificate,
): Promise<IssuedCertificate | undefined> {
  const applied = await readAllOrNothingOutcome(ledger, { outcome, innerHashes }, inner);
  if (applied === undefined) {
    if ((await ledger.mptIssuance(tokenId)) !== undefined) {
      throw new Error(`Batch ${outcome.hash} rejeté mais le MPT ${tokenId} existe`);
    }
    log.info(`→ double financement bloqué par le ledger : Batch ${outcome.hash} validé, aucune transaction interne appliquée`);
    log.info(`→ vérifié on-chain : aucun MPTokenIssuance à l'ID ${tokenId}`);
    return undefined;
  }
  const createdId = createdMptIssuanceId(applied[ISSUANCE_INDEX].meta);
  if (createdId !== tokenId) throw new Error(`ID du MPT facture inattendu : ${createdId} (calculé ${tokenId})`);
  log.info(`MPT facture ${tokenId} (preuve « ${certificate.proofSystem} » dans les métadonnées), remis à Bari`);
  return { certificate, tokenId };
}

/** Renvoie undefined si N est déjà enregistré : aucun MPT n'est alors émis ni transféré. */
export async function issueCertificate(
  client: Client,
  parties: CertificateParties,
  certificate: InvoiceCertificate,
): Promise<IssuedCertificate | undefined> {
  const { sme, bari, registry } = parties;
  const ledger = xrplLedger(client);
  log.info(`N = ${certificate.nullifier}`);
  log.info(`P = ${certificate.pseudonym}`);
  log.info(`C = ${certificate.commitment}`);
  const alreadyRegistered = (await getRegistration(ledger, registry, sme.address, certificate.nullifier)) !== undefined;
  log.info(`registre (ledger_entry) : ${alreadyRegistered ? "N DÉJÀ PRÉSENT" : "N absent"}`);
  // Le Batch est soumis dans tous les cas : c'est son application, ordonnée par le consensus, qui fait foi.
  const sequencer = await BatchSequencer.open(client, sme.address);
  const batch = await buildCertificateBatch(sequencer, { sme: sme.address, bari: bari.address, registry }, certificate);
  log.info(`ID du MPT facture calculé à l'avance : ${batch.tokenId}`);
  const submission = await submitAllOrNothingBatch(client, sme, bari, sequencer, batch.inner, CERTIFICATE_BATCH_LABEL);
  return settleCertificateBatch(ledger, { ...batch, innerHashes: submission.innerHashes }, submission.outcome, certificate);
}

/**
 * Batch du certificat pour une entreprise qui signe dans son wallet : séquences, frais et échéance fixés, transactions
 * internes de Bari couvertes par sa signature dans BatchSigners ; il ne manque que la signature de l'entreprise.
 */
export async function prepareCertificateBatch(
  ports: WalletTxPorts,
  { sme, bari, registry }: { sme: string; bari: Wallet; registry: string },
  certificate: InvoiceCertificate,
): Promise<PreparedCertificate> {
  const { sequence, ledgerIndex } = await ports.accountState(sme);
  const sequencer = BatchSequencer.from(async (account) => (await ports.accountState(account)).sequence, sme, sequence);
  const { tokenId, inner } = await buildCertificateBatch(sequencer, { sme, bari: bari.address, registry }, certificate);
  const unsigned: Batch = {
    ...allOrNothingBatch(sme, inner.map(({ tx }) => tx)),
    Sequence: sequence,
    LastLedgerSequence: ledgerIndex + SIGNING_WINDOW_LEDGERS,
  };
  const batch = await ports.autofill(unsigned, COSIGNER_SIGNATURES);
  signMultiBatch(bari, batch);
  return { batch, tokenId, inner, innerHashes: innerHashesOf(batch) };
}
