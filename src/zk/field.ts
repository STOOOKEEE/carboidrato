// Conversions entre entiers du corps BN254, hexadécimal et comptes XRPL.

import { randomBytes } from "node:crypto";
import { decodeAccountID, encodeAccountID } from "xrpl";
import { ACCOUNT_ID_BYTES, FIELD_BYTES } from "./constants.js";

/** Module du corps scalaire de BN254 (corps du circuit). */
export const BN254_FIELD_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const HEX_RADIX = 16;
const BITS_PER_BYTE = 8n;

export function bytesToBigInt(bytes: Uint8Array): bigint {
  return bytes.length === 0 ? 0n : BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
}

/** Entier → `byteLength` octets big-endian ; refuse toute valeur qui ne tient pas. */
export function bigIntToBytes(value: bigint, byteLength: number): Uint8Array {
  if (value < 0n || value >> (BigInt(byteLength) * BITS_PER_BYTE) !== 0n) {
    throw new RangeError(`Valeur hors bornes pour ${byteLength} octets : ${value}`);
  }
  return Uint8Array.from(Buffer.from(value.toString(HEX_RADIX).padStart(byteLength * 2, "0"), "hex"));
}

/** Élément du corps → hex de 32 octets big-endian, en majuscules (format des Blob XRPL). */
export function toHex32(value: bigint): string {
  return Buffer.from(bigIntToBytes(value, FIELD_BYTES)).toString("hex").toUpperCase();
}

/** Hex (32 octets ou moins) → élément du corps. */
export function fromHex(hex: string): bigint {
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error(`Hexadécimal invalide : ${hex}`);
  }
  const value = BigInt(`0x${hex || "0"}`);
  assertFieldElement(value);
  return value;
}

export function assertFieldElement(value: bigint): void {
  if (value < 0n || value >= BN254_FIELD_MODULUS) {
    throw new RangeError(`Valeur hors du corps BN254 : ${value}`);
  }
}

/** Adresse classique XRPL (r…) → AccountID de 20 octets lu comme entier big-endian. */
export function accountToField(address: string): bigint {
  const accountId = decodeAccountID(address);
  if (accountId.length !== ACCOUNT_ID_BYTES) {
    throw new Error(`AccountID inattendu pour ${address}`);
  }
  return bytesToBigInt(accountId);
}

/** Inverse d'accountToField. */
export function fieldToAccount(value: bigint): string {
  return encodeAccountID(bigIntToBytes(value, ACCOUNT_ID_BYTES));
}

/** Entier aléatoire uniforme sur `byteLength` octets (≤ 31 pour rester dans le corps). */
export function randomField(byteLength: number): bigint {
  return bytesToBigInt(randomBytes(byteLength));
}
