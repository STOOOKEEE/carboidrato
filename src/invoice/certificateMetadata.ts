// Métadonnées du MPT facture (XLS-89) : la preuve Groth16 et ses signaux publics, encodés en compact.
// C'est ce que le jury voit dans l'explorer, et ce que l'audit relit depuis le ledger. N, P, C, la racine et
// les entrées publiques ne sont pas recopiés à part : ils sont relus dans les signaux publics de la preuve,
// ce qui laisse une seule source de vérité.

import { decodeMPTokenMetadata, encodeMPTokenMetadata } from "xrpl";
import {
  decodeProofFromMetadata,
  encodeProofForMetadata,
  fieldToAccount,
  MPT_METADATA_MAX_BYTES,
  parsePublicSignals,
  statementHex,
  type InvoiceProof,
} from "../zk/index.js";
import { hexByteLength } from "../lib/encoding.js";

const METADATA_VERSION = 2;
export const GROTH16_PROOF_SYSTEM = "groth16";

export interface CertificateMetadata {
  proofSystem: string;
  proof: InvoiceProof;
  nullifier: string;
  pseudonym: string;
  commitment: string;
  debtorsRoot: string;
  /** PME prouvée : doit être l'émetteur du MPT facture et l'emprunteur. */
  account: string;
  vintage: number;
  networkId: number;
  registry: string;
  thresholdCents: number;
  dueDate: number;
}

export function encodeCertificateMetadata(proof: InvoiceProof): string {
  const { nullifier } = statementHex(parsePublicSignals(proof.publicSignals));
  const hex = encodeMPTokenMetadata({
    ticker: "BINV",
    name: `Facture certifiée ${nullifier.slice(0, 8)}`,
    icon: "https://xrpl.org/favicon.ico",
    asset_class: "rwa",
    asset_subclass: "private_credit",
    issuer_name: "PME emprunteuse (Bari)",
    additional_info: { v: METADATA_VERSION, sys: GROTH16_PROOF_SYSTEM, proof: encodeProofForMetadata(proof) },
  });
  if (hexByteLength(hex) > MPT_METADATA_MAX_BYTES) {
    throw new Error(`Métadonnées du MPT facture trop longues (${hexByteLength(hex)} o > ${MPT_METADATA_MAX_BYTES})`);
  }
  return hex;
}

function toSafeNumber(value: bigint, label: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`Certificat : ${label} hors bornes`);
  return Number(value);
}

/** Relit un certificat depuis MPTokenMetadata ; lève une erreur si ce n'est pas un certificat Bari. */
export function decodeCertificateMetadata(metadataHex: string): CertificateMetadata {
  const info = decodeMPTokenMetadata(metadataHex).additional_info;
  if (typeof info !== "object" || info === null) throw new Error("Métadonnées sans additional_info : pas un certificat Bari");
  if (info.v !== METADATA_VERSION) throw new Error(`Version de certificat inconnue : ${String(info.v)}`);
  if (info.sys !== GROTH16_PROOF_SYSTEM) throw new Error(`Système de preuve inconnu : ${String(info.sys)}`);
  if (typeof info.proof !== "string") throw new Error("Certificat : preuve absente");

  const proof = decodeProofFromMetadata(info.proof);
  const statement = parsePublicSignals(proof.publicSignals);
  const { nullifier, pseudonym, commitment, merkleRoot } = statementHex(statement);
  return {
    proofSystem: GROTH16_PROOF_SYSTEM,
    proof,
    nullifier,
    pseudonym,
    commitment,
    debtorsRoot: merkleRoot,
    account: fieldToAccount(statement.account),
    vintage: toSafeNumber(statement.vintage, "millésime"),
    networkId: toSafeNumber(statement.networkId, "networkId"),
    registry: fieldToAccount(statement.registry),
    thresholdCents: toSafeNumber(statement.threshold, "seuil"),
    dueDate: toSafeNumber(statement.dueDate, "échéance"),
  };
}
