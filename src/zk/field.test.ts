// Tests du corps BN254 : un témoin hors du corps du circuit doit être refusé avant la preuve.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BN254_FIELD_MODULUS, fromHex, toHex32 } from "./field.js";

/** Ordre du sous-groupe de BN254, corps scalaire de circom et snarkjs. */
const BN254_SUBGROUP_ORDER = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

describe("corps BN254", () => {
  test("le module est l'ordre du sous-groupe utilisé par le circuit", () => {
    assert.equal(BN254_FIELD_MODULUS, BN254_SUBGROUP_ORDER);
  });

  test("fromHex refuse le module et accepte le plus grand élément du corps", () => {
    assert.throws(() => fromHex(BN254_SUBGROUP_ORDER.toString(16)), RangeError);
    assert.equal(fromHex(toHex32(BN254_SUBGROUP_ORDER - 1n)), BN254_SUBGROUP_ORDER - 1n);
  });
});
