// Encodage compact d'une preuve et de ses signaux publics pour MPTokenMetadata (limite ledger : 1024 octets).
// Format binaire v1, puis base64 :
//   [version: 1 o][pi_a: 2×32 o][pi_b: 4×32 o][pi_c: 2×32 o][signaux publics, largeurs fixes de SIGNAL_BYTES]
// Les coordonnées projectives constantes (z = 1) de snarkjs ne sont pas stockées.

import { ACCOUNT_ID_BYTES, FIELD_BYTES } from "./constants.js";
import { bigIntToBytes, bytesToBigInt } from "./field.js";
import { PUBLIC_SIGNAL_ORDER, type InvoiceProof, type PublicSignalName } from "./statement.js";

const FORMAT_VERSION = 1;
const VERSION_BYTES = 1;
const PROOF_COORDINATES = 8;
const UINT64_BYTES = 8;
const UINT32_BYTES = 4;

/** Largeur de chaque signal public : 32 octets pour les hachages, au plus juste pour le reste. */
const SIGNAL_BYTES: Record<PublicSignalName, number> = {
  commitment: FIELD_BYTES,
  nullifier: FIELD_BYTES,
  pseudonym: FIELD_BYTES,
  debtorsRoot: FIELD_BYTES,
  account: ACCOUNT_ID_BYTES,
  threshold: UINT64_BYTES,
  dueDate: UINT64_BYTES,
  networkId: UINT32_BYTES,
  registry: ACCOUNT_ID_BYTES,
  vintage: UINT32_BYTES,
};

/** Taille binaire exacte d'une preuve encodée (avant base64). */
export const ENCODED_PROOF_BYTES =
  VERSION_BYTES +
  PROOF_COORDINATES * FIELD_BYTES +
  PUBLIC_SIGNAL_ORDER.reduce((total, name) => total + SIGNAL_BYTES[name], 0);

/** Limite de MPTokenMetadata imposée par le ledger. */
export const MPT_METADATA_MAX_BYTES = 1024;

/** Preuve + signaux publics → chaîne base64 compacte, à placer dans les métadonnées du MPT facture. */
export function encodeProofForMetadata({ proof, publicSignals }: InvoiceProof): string {
  if (publicSignals.length !== PUBLIC_SIGNAL_ORDER.length) {
    throw new Error(`Nombre de signaux publics inattendu : ${publicSignals.length}`);
  }
  const [ax, ay] = proof.pi_a;
  const [[bx0, bx1], [by0, by1]] = proof.pi_b;
  const [cx, cy] = proof.pi_c;
  const parts = [
    Uint8Array.of(FORMAT_VERSION),
    ...[ax, ay, bx0, bx1, by0, by1, cx, cy].map((coordinate) => bigIntToBytes(BigInt(coordinate), FIELD_BYTES)),
    ...PUBLIC_SIGNAL_ORDER.map((name, index) => bigIntToBytes(BigInt(publicSignals[index]), SIGNAL_BYTES[name])),
  ];
  return Buffer.concat(parts).toString("base64");
}

/** Inverse d'encodeProofForMetadata ; rejette tout format ou toute taille inattendus. */
export function decodeProofFromMetadata(encoded: string): InvoiceProof {
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length !== ENCODED_PROOF_BYTES || bytes[0] !== FORMAT_VERSION) {
    throw new Error("Preuve encodée invalide (version ou taille)");
  }
  let offset = VERSION_BYTES;
  const readNumber = (byteLength: number): string => {
    const value = bytesToBigInt(bytes.subarray(offset, offset + byteLength));
    offset += byteLength;
    return value.toString();
  };
  const [ax, ay, bx0, bx1, by0, by1, cx, cy] = Array.from({ length: PROOF_COORDINATES }, () => readNumber(FIELD_BYTES));
  const publicSignals = PUBLIC_SIGNAL_ORDER.map((name) => readNumber(SIGNAL_BYTES[name]));
  return {
    proof: {
      pi_a: [ax, ay, "1"],
      pi_b: [[bx0, bx1], [by0, by1], ["1", "0"]],
      pi_c: [cx, cy, "1"],
      protocol: "groth16",
      curve: "bn128",
    },
    publicSignals,
  };
}
