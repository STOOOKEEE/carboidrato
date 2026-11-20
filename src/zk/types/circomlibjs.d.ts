// Typage minimal de circomlibjs (le paquet n'en fournit pas) : seules les primitives utilisées par src/zk.
declare module "circomlibjs" {
  /** Élément du corps BN254 en représentation interne (Montgomery). */
  export type FieldElement = Uint8Array;
  export type FieldInput = FieldElement | bigint | number | string;

  export interface ScalarField {
    e(value: FieldInput): FieldElement;
    toObject(element: FieldElement): bigint;
  }

  export interface PoseidonHasher {
    (inputs: FieldInput[]): FieldElement;
    F: ScalarField;
  }

  export interface EdDSAPoseidonSignature {
    R8: [FieldElement, FieldElement];
    S: bigint;
  }

  export interface Eddsa {
    F: ScalarField;
    poseidon: PoseidonHasher;
    prv2pub(privateKey: Uint8Array): [FieldElement, FieldElement];
    signPoseidon(privateKey: Uint8Array, message: FieldElement): EdDSAPoseidonSignature;
    verifyPoseidon(
      message: FieldElement,
      signature: EdDSAPoseidonSignature,
      publicKey: [FieldElement, FieldElement],
    ): boolean;
  }

  export function buildEddsa(): Promise<Eddsa>;
}
