// Liste des débiteurs vérifiés : arbre de Merkle Poseidon de profondeur fixe, feuille = Poseidon(Ax, Ay).

import { EMPTY_LEAF, MERKLE_DEPTH } from "./constants.js";
import type { DebtorPublicKey } from "./debtor.js";
import { poseidon } from "./primitives.js";

const TREE_CAPACITY = 2 ** MERKLE_DEPTH;

export interface DebtorList {
  root: bigint;
  /** levels[0] = feuilles (complétées par EMPTY_LEAF), levels[MERKLE_DEPTH] = [racine]. */
  levels: bigint[][];
}

export interface MerklePath {
  pathElements: bigint[];
  /** 0 : nœud courant à gauche, 1 : à droite. */
  pathIndices: number[];
}

export function debtorLeaf(key: DebtorPublicKey): Promise<bigint> {
  return poseidon([key.ax, key.ay]);
}

export async function buildDebtorList(keys: DebtorPublicKey[]): Promise<DebtorList> {
  if (keys.length > TREE_CAPACITY) {
    throw new RangeError(`Trop de débiteurs : ${keys.length} > ${TREE_CAPACITY}`);
  }
  const leaves = await Promise.all(keys.map(debtorLeaf));
  const levels: bigint[][] = [[...leaves, ...Array<bigint>(TREE_CAPACITY - leaves.length).fill(EMPTY_LEAF)]];
  for (let depth = 0; depth < MERKLE_DEPTH; depth++) {
    const below = levels[depth];
    const above: bigint[] = [];
    for (let i = 0; i < below.length; i += 2) {
      above.push(await poseidon([below[i], below[i + 1]]));
    }
    levels.push(above);
  }
  return { root: levels[MERKLE_DEPTH][0], levels };
}

/** Chemin d'appartenance d'un débiteur ; échoue s'il n'est pas dans la liste. */
export async function merklePath(list: DebtorList, key: DebtorPublicKey): Promise<MerklePath> {
  const leaf = await debtorLeaf(key);
  let index = list.levels[0].indexOf(leaf);
  if (index < 0) {
    throw new Error("Débiteur absent de la liste vérifiée");
  }
  const pathElements: bigint[] = [];
  const pathIndices: number[] = [];
  for (let depth = 0; depth < MERKLE_DEPTH; depth++) {
    pathIndices.push(index % 2);
    pathElements.push(list.levels[depth][index ^ 1]);
    index = Math.floor(index / 2);
  }
  return { pathElements, pathIndices };
}
