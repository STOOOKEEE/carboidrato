// Pré-contrôle d'une facture attestée, calculé dans le navigateur : la facture ne part jamais au serveur. Seules des
// données publiques sont demandées à l'API (liste des débiteurs, paramètres de la preuve, registre de N, KYB, offre).

import {
  ATTESTED_INVOICE_FORMAT,
  CHECK_IDS,
  type AttestedInvoiceFile,
  type CheckId,
  type LoanOffer,
  type OfferSchedule,
  type PrecheckResponse,
  type ProofParams,
  type PublicDebtor,
  type RegistryLookup,
} from "../../../../src/api/contract";
import { debtorTree, invoiceNullifier, isListed, provenThreshold } from "./witness";

const MS_PER_SECOND = 1_000;
const CENTS_PER_EUR = 100;

/** Sources publiques du pré-contrôle, injectées pour le tester sans réseau. */
export interface PrecheckSources {
  debtors(): Promise<readonly PublicDebtor[]>;
  params(): Promise<Pick<ProofParams, "networkId" | "registry" | "thresholdsCents">>;
  registration(nullifier: string, account: string): Promise<RegistryLookup>;
  kybDone(account: string): Promise<boolean>;
  /** Barème du fonds (une offre par palier) pour une échéance ISO. */
  offer(dueDate: string): Promise<OfferSchedule>;
  signatureIsValid(file: AttestedInvoiceFile): Promise<boolean>;
  now(): Date;
}

function hasStrings(value: unknown, keys: readonly string[]): boolean {
  return typeof value === "object" && value !== null && keys.every((key) => typeof Reflect.get(value, key) === "string");
}

/** Fichier .bari.json lu tel quel : undefined s'il ne s'agit pas d'une facture attestée complète. */
export function parseAttestedFile(value: unknown): AttestedInvoiceFile | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { format, invoice, attestation } = value as Partial<AttestedInvoiceFile>;
  const complete =
    format === ATTESTED_INVOICE_FORMAT &&
    hasStrings(invoice, ["number", "debtorName", "description", "issueDate"]) &&
    hasStrings(attestation, ["account", "amountCents", "dueDate", "registry", "uuid"]) &&
    typeof attestation?.networkId === "number" &&
    hasStrings(attestation.debtorPublicKey, ["ax", "ay"]) &&
    hasStrings(attestation.signature, ["r8x", "r8y", "s"]);
  return complete ? (value as AttestedInvoiceFile) : undefined;
}

/** Offre du palier que prouvera la facture, lue dans le barème du fonds (avance, frais et coût calculés par l'API). */
function provenTierOffer(schedule: OfferSchedule, thresholdCents: bigint): LoanOffer | undefined {
  return schedule.tiers.find((tier) => BigInt(Math.round(tier.provenThresholdEur * CENTS_PER_EUR)) === thresholdCents);
}

export async function runPrecheck(file: AttestedInvoiceFile, sources: PrecheckSources): Promise<PrecheckResponse> {
  const { attestation } = file;
  const nullifier = invoiceNullifier(attestation.uuid);
  const dueDate = new Date(Number(attestation.dueDate) * MS_PER_SECOND);
  const [debtors, params, registration, kybDone, signatureOk] = await Promise.all([
    sources.debtors(),
    sources.params(),
    sources.registration(nullifier, attestation.account),
    sources.kybDone(attestation.account),
    sources.signatureIsValid(file),
  ]);
  const threshold = provenThreshold(attestation.amountCents, params.thresholdsCents);
  const outcomes: Record<CheckId, boolean> = {
    signature: signatureOk,
    debtor: isListed(debtorTree(debtors), attestation.debtorPublicKey),
    network: attestation.networkId === params.networkId && attestation.registry === params.registry,
    amount: threshold !== undefined,
    dueDate: dueDate.getTime() > sources.now().getTime(),
    unique: !registration.registered,
  };
  const checks = CHECK_IDS.map((id) => ({ id, ok: outcomes[id] }));
  const eligible = checks.every((check) => check.ok);
  return {
    verdict: eligible ? "eligible" : "rejected",
    invoice: {
      number: file.invoice.number,
      debtorName: file.invoice.debtorName,
      amountEur: Number(attestation.amountCents) / CENTS_PER_EUR,
      dueDate: dueDate.toISOString(),
    },
    checks,
    kyb: { account: attestation.account, done: kybDone },
    nullifier,
    ...(registration.txHash === undefined ? {} : { registeredBy: registration.txHash }),
    ...(eligible && threshold !== undefined ? { offer: provenTierOffer(await sources.offer(dueDate.toISOString()), threshold) } : {}),
  };
}
