// Témoin de la preuve construit dans le navigateur : arbre de Merkle des débiteurs publics (Poseidon) et entrée
// du circuit bari_invoice, aux mêmes noms de signaux que src/zk/prover.ts. Rien de ceci ne part au serveur.

import { poseidon2 } from "poseidon-lite/poseidon2";
import { decodeAccountID } from "ripple-address-codec";
import type { AttestedInvoiceFile, PublicDebtor } from "../../../../src/api/contract";

/** Constantes du circuit (src/zk/constants.ts) : la parité est vérifiée par le fixture. */
const MERKLE_DEPTH = 8;
const EMPTY_LEAF = 0n;

export type DebtorKey = PublicDebtor["publicKey"];

export interface DebtorTree {
  root: bigint;
  /** levels[0] = feuilles complétées par EMPTY_LEAF, levels[MERKLE_DEPTH] = [racine]. */
  levels: bigint[][];
}

export interface MerklePath {
  pathElements: bigint[];
  /** 0 : nœud courant à gauche, 1 : à droite. */
  pathIndices: number[];
}

export type CircuitInput = Record<string, string | string[]>;

export interface WitnessRequest {
  file: AttestedInvoiceFile;
  debtors: readonly PublicDebtor[];
  threshold: bigint;
  vintage: bigint;
  blinding: bigint;
}

function leafOf(key: DebtorKey): bigint {
  return poseidon2([BigInt(key.ax), BigInt(key.ay)]);
}

export function debtorTree(debtors: readonly PublicDebtor[]): DebtorTree {
  const capacity = 2 ** MERKLE_DEPTH;
  if (debtors.length > capacity) throw new RangeError(`Too many debtors: ${debtors.length} > ${capacity}`);
  const leaves = debtors.map(({ publicKey }) => leafOf(publicKey));
  const levels: bigint[][] = [[...leaves, ...Array<bigint>(capacity - leaves.length).fill(EMPTY_LEAF)]];
  for (let depth = 0; depth < MERKLE_DEPTH; depth++) {
    const below = levels[depth];
    const above: bigint[] = [];
    for (let i = 0; i < below.length; i += 2) above.push(poseidon2([below[i], below[i + 1]]));
    levels.push(above);
  }
  return { root: levels[MERKLE_DEPTH][0], levels };
}

/** Chemin d'appartenance d'un débiteur ; échoue s'il n'est pas dans la liste, la preuve serait impossible. */
export function merklePathOf(tree: DebtorTree, key: DebtorKey): MerklePath {
  let index = tree.levels[0].indexOf(leafOf(key));
  if (index < 0) throw new Error("The debtor is not on Bari's verified list");
  const pathElements: bigint[] = [];
  const pathIndices: number[] = [];
  for (let depth = 0; depth < MERKLE_DEPTH; depth++) {
    pathIndices.push(index % 2);
    pathElements.push(tree.levels[depth][index ^ 1]);
    index = Math.floor(index / 2);
  }
  return { pathElements, pathIndices };
}

/** Adresse classique XRPL → AccountID de 20 octets lu comme entier big-endian (src/zk/field.ts). */
function accountToField(address: string): bigint {
  const accountId = decodeAccountID(address);
  return BigInt(`0x${Array.from(accountId, (byte) => byte.toString(16).padStart(2, "0")).join("")}`);
}

export function buildCircuitInput({ file, debtors, threshold, vintage, blinding }: WitnessRequest): CircuitInput {
  const { attestation } = file;
  const tree = debtorTree(debtors);
  const path = merklePathOf(tree, attestation.debtorPublicKey);
  return {
    amount: attestation.amountCents,
    uuid: BigInt(`0x${attestation.uuid}`).toString(),
    debtorAx: attestation.debtorPublicKey.ax,
    debtorAy: attestation.debtorPublicKey.ay,
    sigR8x: attestation.signature.r8x,
    sigR8y: attestation.signature.r8y,
    sigS: attestation.signature.s,
    pathElements: path.pathElements.map(String),
    pathIndices: path.pathIndices.map(String),
    blinding: blinding.toString(),
    debtorsRoot: tree.root.toString(),
    account: accountToField(attestation.account).toString(),
    threshold: threshold.toString(),
    dueDate: attestation.dueDate,
    networkId: attestation.networkId.toString(),
    registry: accountToField(attestation.registry).toString(),
    vintage: vintage.toString(),
  };
}
