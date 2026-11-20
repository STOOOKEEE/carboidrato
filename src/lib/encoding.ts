import { createHash } from "node:crypto";
import { convertStringToHex } from "xrpl";

/** Texte UTF-8 → hexadécimal majuscule (format des champs Blob XRPL). */
export function textToHex(text: string): string {
  return convertStringToHex(text).toUpperCase();
}

export function sha256Hex(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Taille en octets d'une chaîne hexadécimale. */
export function hexByteLength(hex: string): number {
  return hex.length / 2;
}
