// Entrées de la preuve à partir d'une facture attestée : contrôles préalables (signature du débiteur, PME,
// registre, réseau, seuil, débiteur vérifié), puis entrée du circuit au format exact de snarkjs (chaînes décimales),
// pour que le navigateur lance groth16.fullProve avec les artefacts servis par l'API.

import { INVOICE_AMOUNT_EUR } from "../../config/finance.js";
import { verifiedDebtorList } from "../../invoice/certificate.js";
import { eurToCents } from "../../lib/amounts.js";
import { BLINDING_BYTES } from "../../zk/constants.js";
import { randomField } from "../../zk/field.js";
import {
  accountToField,
  computeAttestedMessage,
  debtorLeaf,
  merklePath,
  verifyAttestation,
  type DebtorPublicKey,
  type MerklePath,
  type ProveInput,
} from "../../zk/index.js";
import { toCircuitAttestation } from "../attestedInvoice.js";
import type { AttestedInvoiceFile } from "../contract.js";
import { HttpError } from "./errors.js";

const HTTP_UNPROCESSABLE = 422;

/** Ce que la preuve doit établir pour ce fonds (lu dans la fiche du fonds et le contexte de la démo). */
export interface ProofExpectations {
  smeAccount: string;
  registry: string;
  networkId: number;
  debtorsRoot: bigint;
  vintage: bigint;
}

/** Seuil prouvé : la facture type du fonds, dont le principal du prêt est la part avancée. */
export const PROVEN_THRESHOLD_CENTS = eurToCents(INVOICE_AMOUNT_EUR);

/** Entrée du circuit bari_invoice : chaque signal en chaîne décimale (format attendu par snarkjs). */
export type CircuitInput = Record<string, string | string[]>;

function refuse(message: string): never {
  throw new HttpError(HTTP_UNPROCESSABLE, message);
}

export interface DebtorPath {
  publicKey: DebtorPublicKey;
  leaf: bigint;
  root: bigint;
  path: MerklePath;
}

/** Chemin de Merkle d'un débiteur dans la liste vérifiée de Bari ; refus s'il n'y figure pas. */
export async function debtorPath(publicKey: DebtorPublicKey): Promise<DebtorPath> {
  const list = await verifiedDebtorList();
  const leaf = await debtorLeaf(publicKey);
  if (!list.levels[0].includes(leaf)) refuse("Débiteur absent de la liste vérifiée de Bari");
  return { publicKey, leaf, root: list.root, path: await merklePath(list, publicKey) };
}

/** Contrôle l'attestation et construit l'entrée de la preuve, avec un aléa r neuf pour l'engagement C. */
export async function buildProveInput(file: AttestedInvoiceFile, expected: ProofExpectations): Promise<ProveInput> {
  const fields = toCircuitAttestation(file);
  if (!(await verifyAttestation(fields))) refuse("Signature du débiteur invalide");
  if (fields.account !== accountToField(expected.smeAccount)) refuse("La facture n'est pas attestée au nom de la PME de la démo");
  if (fields.registry !== accountToField(expected.registry)) refuse("La facture n'est pas liée au registre de ce fonds");
  if (fields.networkId !== BigInt(expected.networkId)) refuse("La facture est attestée pour un autre réseau");
  if (fields.amount < PROVEN_THRESHOLD_CENTS) refuse(`Montant inférieur au seuil du fonds (${INVOICE_AMOUNT_EUR} €)`);

  const debtor = await debtorPath(fields.debtorPublicKey);
  if (debtor.root !== expected.debtorsRoot) refuse("La liste des débiteurs a changé depuis la création du fonds");
  return {
    attestation: { ...fields, message: await computeAttestedMessage(fields) },
    merklePath: debtor.path,
    debtorsRoot: expected.debtorsRoot,
    threshold: PROVEN_THRESHOLD_CENTS,
    vintage: expected.vintage,
    blinding: randomField(BLINDING_BYTES),
  };
}

/** Même correspondance signal ↔ valeur que src/zk/prover.ts (ordre et noms du circuit). */
export function toCircuitInput(input: ProveInput): CircuitInput {
  const { attestation, merklePath: path, debtorsRoot, threshold, vintage, blinding } = input;
  if (blinding === undefined) throw new Error("Aléa de l'engagement manquant");
  return {
    amount: attestation.amount.toString(),
    uuid: attestation.uuid.toString(),
    debtorAx: attestation.debtorPublicKey.ax.toString(),
    debtorAy: attestation.debtorPublicKey.ay.toString(),
    sigR8x: attestation.signature.r8x.toString(),
    sigR8y: attestation.signature.r8y.toString(),
    sigS: attestation.signature.s.toString(),
    pathElements: path.pathElements.map(String),
    pathIndices: path.pathIndices.map(String),
    blinding: blinding.toString(),
    debtorsRoot: debtorsRoot.toString(),
    account: attestation.account.toString(),
    threshold: threshold.toString(),
    dueDate: attestation.dueDate.toString(),
    networkId: attestation.networkId.toString(),
    registry: attestation.registry.toString(),
    vintage: vintage.toString(),
  };
}
