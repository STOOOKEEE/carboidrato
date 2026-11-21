// Attestation signée dans le navigateur de l'organisme public, à l'identique de src/zk/debtor.ts (uuid HMAC du numéro
// canonique, EdDSA-Poseidon sur BabyJubJub) : la facture ne part jamais au serveur. Parité vérifiée par le fixture.

import { blake512 } from "@noble/hashes/blake1.js";
import { poseidon5 } from "poseidon-lite/poseidon5";
import { poseidon8 } from "poseidon-lite/poseidon8";
import { decodeAccountID } from "ripple-address-codec";
import { ATTESTED_INVOICE_FORMAT, type AttestedInvoiceFile, type PublicBodyKeys } from "../../../../src/api/contract";

/** Corps BN254 du circuit, courbe BabyJubJub (twisted Edwards a·x² + y² = 1 + d·x²·y²) et son point de base 8·G. */
const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const CURVE_A = 168700n;
const CURVE_D = 168696n;
const BASE8: Point = [
  5299619240641551281634865583518297030282874472190772894086521144482721001553n,
  16950150798460657717958625567821834550301663161624707787222815936182638968203n,
];
/** Ordre du sous-groupe engendré par BASE8. */
const SUB_ORDER = 2736030358979909402780800718157159386076813972158567259200215660948447373041n;
/** uuid = 31 premiers octets du HMAC-SHA256 : toujours sous le module du corps. */
const UUID_BYTES = 31;
const FIELD_BYTES = 32;
const MS_PER_SECOND = 1_000;

type Point = readonly [bigint, bigint];

export interface AttestRequest {
  keys: PublicBodyKeys;
  /** Compte XRPL du fournisseur, lié par la signature. */
  supplierAccount: string;
  invoice: { number: string; issueDate: string; amountCents: bigint; dueDate: string; description: string };
  networkId: number;
  /** Compte registre de Bari. */
  registry: string;
}

/** Même forme que normalizeInvoiceNumber (src/invoice) : deux saisies de la même facture donnent le même uuid. */
export function canonicalInvoiceNumber(number: string): string {
  return number.trim().toUpperCase().replace(/\s+/g, "");
}

const mod = (value: bigint, modulus = FIELD) => ((value % modulus) + modulus) % modulus;

function inverse(value: bigint): bigint {
  let [low, high, a, b] = [mod(value), FIELD, 1n, 0n];
  while (low > 1n) {
    const quotient = high / low;
    [low, high, a, b] = [high - quotient * low, low, b - quotient * a, a];
  }
  return mod(a);
}

/** Addition sur BabyJubJub, formules de circomlibjs (babyjub.addPoint). */
function addPoints([x1, y1]: Point, [x2, y2]: Point): Point {
  const beta = mod(x1 * y2);
  const gamma = mod(y1 * x2);
  const delta = mod((y1 - CURVE_A * x1) * (x2 + y2));
  const dTau = mod(CURVE_D * beta * gamma);
  return [mod((beta + gamma) * inverse(1n + dTau)), mod((delta + CURVE_A * beta - gamma) * inverse(1n - dTau))];
}

function multiplyPoint(base: Point, scalar: bigint): Point {
  let result: Point = [0n, 1n];
  let power = base;
  for (let rest = scalar; rest > 0n; rest >>= 1n) {
    if (rest & 1n) result = addPoints(result, power);
    power = addPoints(power, power);
  }
  return result;
}

const hexToBytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
const bigEndian = (bytes: Uint8Array) => BigInt(`0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("") || "0"}`);
const littleEndian = (bytes: Uint8Array) => bigEndian(Uint8Array.from(bytes).reverse());

/** Adresse classique XRPL → AccountID de 20 octets lu comme entier big-endian (src/zk/field.ts). */
const accountToField = (address: string) => bigEndian(decodeAccountID(address));

/** EdDSA-Poseidon de circomlibjs (eddsa.signPoseidon) : clé élaguée et nonce dérivés de BLAKE-512. */
function signPoseidon(privateKeyHex: string, publicKey: Point, message: bigint) {
  const digest = blake512(hexToBytes(privateKeyHex));
  const pruned = digest.slice(0, FIELD_BYTES);
  pruned[0] &= 0xf8;
  pruned[31] &= 0x7f;
  pruned[31] |= 0x40;
  const secret = littleEndian(pruned);
  const messageBytes = hexToBytes(message.toString(16).padStart(FIELD_BYTES * 2, "0")).reverse();
  const nonce = mod(littleEndian(blake512(Uint8Array.from([...digest.slice(FIELD_BYTES), ...messageBytes]))), SUB_ORDER);
  const [r8x, r8y] = multiplyPoint(BASE8, nonce);
  const challenge = poseidon5([r8x, r8y, publicKey[0], publicKey[1], message]);
  return { r8x, r8y, s: mod(nonce + challenge * secret, SUB_ORDER) };
}

/** uuid = HMAC-SHA256(clé de l'organisme, numéro canonique), réduit à ses 31 premiers octets. */
async function invoiceUuid(hmacKeyHex: string, number: string): Promise<bigint> {
  const key = await crypto.subtle.importKey("raw", hexToBytes(hmacKeyHex), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonicalInvoiceNumber(number)));
  return bigEndian(new Uint8Array(mac).subarray(0, UUID_BYTES));
}

const utcMidnight = (isoDate: string) => new Date(`${isoDate}T00:00:00Z`);

/** Fichier `.bari.json` que l'organisme remet à son fournisseur, comme toAttestedInvoiceFile (src/api). */
export async function attestInvoice({ keys, supplierAccount, invoice, networkId, registry }: AttestRequest): Promise<AttestedInvoiceFile> {
  const publicKey: Point = [BigInt(keys.publicKey.ax), BigInt(keys.publicKey.ay)];
  const uuid = await invoiceUuid(keys.hmacKey, invoice.number);
  const dueDate = BigInt(utcMidnight(invoice.dueDate).getTime() / MS_PER_SECOND);
  // m = Poseidon(compte, Ax, Ay, montant, échéance, uuid, networkId, registre), recalculé tel quel par le circuit.
  const message = poseidon8([
    accountToField(supplierAccount),
    publicKey[0],
    publicKey[1],
    invoice.amountCents,
    dueDate,
    uuid,
    BigInt(networkId),
    accountToField(registry),
  ]);
  const signature = signPoseidon(keys.eddsaPrivateKey, publicKey, message);
  return {
    format: ATTESTED_INVOICE_FORMAT,
    invoice: {
      number: invoice.number.trim(),
      debtorName: keys.name,
      description: invoice.description,
      issueDate: utcMidnight(invoice.issueDate).toISOString(),
    },
    attestation: {
      account: supplierAccount,
      amountCents: invoice.amountCents.toString(),
      dueDate: dueDate.toString(),
      networkId,
      registry,
      uuid: uuid.toString(16).toUpperCase().padStart(FIELD_BYTES * 2, "0"),
      debtorPublicKey: keys.publicKey,
      signature: { r8x: signature.r8x.toString(), r8y: signature.r8y.toString(), s: signature.s.toString() },
    },
  };
}
