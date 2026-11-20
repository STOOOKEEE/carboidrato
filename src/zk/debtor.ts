// Débiteur simulé (la mairie) : clé EdDSA BabyJubJub dédiée, uuid HMAC et attestation signée d'une facture.
// Vérification de l'attestation et empreinte N, calculées hors circuit pour le pré-contrôle d'une facture.

import { createHmac } from "node:crypto";
import { DEMO_DEBTOR_SECRET, DOMAIN_N, UUID_BYTES } from "./constants.js";
import { accountToField, bytesToBigInt } from "./field.js";
import { getEddsa, poseidon } from "./primitives.js";

/** Étiquettes de dérivation : une clé par usage, à partir du secret maître du débiteur. */
const HMAC_KEY_LABEL = "bari/uuid-hmac";
const EDDSA_KEY_LABEL = "bari/eddsa-babyjubjub";

export interface DebtorPublicKey {
  ax: bigint;
  ay: bigint;
}

export interface DebtorIdentity {
  name: string;
  /** Secret HMAC du débiteur : rend l'uuid indevinable. */
  hmacKey: Buffer;
  /** Clé privée EdDSA (32 octets). */
  eddsaPrivateKey: Buffer;
  publicKey: DebtorPublicKey;
}

/** Facture telle que la voit le débiteur. Montants en centimes, échéance en secondes Unix. */
export interface InvoiceClaim {
  /** Adresse XRPL de la PME créancière. */
  account: string;
  amount: bigint;
  dueDate: bigint;
  /** Numéro officiel de la facture (ex. identifiant SdI). Ne sort jamais de chez le débiteur et la PME. */
  invoiceNumber: string;
  networkId: number;
  /** Adresse XRPL du registre Bari. */
  registry: string;
}

export interface EdDSASignature {
  r8x: bigint;
  r8y: bigint;
  s: bigint;
}

/** Attestation remise à la PME : tous les champs sont des entiers du corps, prêts pour le circuit. */
export interface DebtorAttestation {
  account: bigint;
  amount: bigint;
  dueDate: bigint;
  networkId: bigint;
  registry: bigint;
  uuid: bigint;
  debtorPublicKey: DebtorPublicKey;
  /** m = Poseidon(compte, Ax, Ay, montant, échéance, uuid, networkId, registre). */
  message: bigint;
  signature: EdDSASignature;
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

/** Débiteur de démo, dérivé de façon déterministe de DEMO_DEBTOR_SECRET et de son nom. */
export async function deriveDebtor(name: string): Promise<DebtorIdentity> {
  const master = hmac(DEMO_DEBTOR_SECRET, name);
  const eddsaPrivateKey = hmac(master, EDDSA_KEY_LABEL);
  const eddsa = await getEddsa();
  const [ax, ay] = eddsa.prv2pub(eddsaPrivateKey);
  return {
    name,
    hmacKey: hmac(master, HMAC_KEY_LABEL),
    eddsaPrivateKey,
    publicKey: { ax: eddsa.F.toObject(ax), ay: eddsa.F.toObject(ay) },
  };
}

/** uuid = HMAC-SHA256(secret du débiteur, n° officiel), réduit à ses 31 premiers octets (< module BN254). */
export function computeInvoiceUuid(hmacKey: Buffer, invoiceNumber: string): bigint {
  return bytesToBigInt(hmac(hmacKey, invoiceNumber).subarray(0, UUID_BYTES));
}

type MessageFields = Omit<DebtorAttestation, "message" | "signature">;

/** Message signé par le débiteur, recalculé à l'identique dans le circuit. */
export function computeAttestedMessage(fields: MessageFields): Promise<bigint> {
  const { account, debtorPublicKey, amount, dueDate, uuid, networkId, registry } = fields;
  return poseidon([account, debtorPublicKey.ax, debtorPublicKey.ay, amount, dueDate, uuid, networkId, registry]);
}

/** Le débiteur atteste une facture : uuid déterministe, puis signature EdDSA-Poseidon de m. */
export async function attestInvoice(debtor: DebtorIdentity, claim: InvoiceClaim): Promise<DebtorAttestation> {
  const fields: MessageFields = {
    account: accountToField(claim.account),
    amount: claim.amount,
    dueDate: claim.dueDate,
    networkId: BigInt(claim.networkId),
    registry: accountToField(claim.registry),
    uuid: computeInvoiceUuid(debtor.hmacKey, claim.invoiceNumber),
    debtorPublicKey: debtor.publicKey,
  };
  const message = await computeAttestedMessage(fields);
  const eddsa = await getEddsa();
  const signature = eddsa.signPoseidon(debtor.eddsaPrivateKey, eddsa.F.e(message));
  return {
    ...fields,
    message,
    signature: {
      r8x: eddsa.F.toObject(signature.R8[0]),
      r8y: eddsa.F.toObject(signature.R8[1]),
      s: signature.S,
    },
  };
}

/**
 * Vérifie la signature du débiteur en recalculant m depuis les champs (le message fourni n'est jamais cru) :
 * un seul champ modifié après la signature rend l'attestation invalide.
 */
export async function verifyAttestation(attestation: Omit<DebtorAttestation, "message">): Promise<boolean> {
  const message = await computeAttestedMessage(attestation);
  const eddsa = await getEddsa();
  const { F } = eddsa;
  const { signature, debtorPublicKey } = attestation;
  return eddsa.verifyPoseidon(
    F.e(message),
    { R8: [F.e(signature.r8x), F.e(signature.r8y)], S: signature.s },
    [F.e(debtorPublicKey.ax), F.e(debtorPublicKey.ay)],
  );
}

/** Empreinte anti-doublon N = Poseidon(DOMAIN_N, uuid), identique à la sortie publique du circuit. */
export function invoiceNullifier(uuid: bigint): Promise<bigint> {
  return poseidon([DOMAIN_N, uuid]);
}
