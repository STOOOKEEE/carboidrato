// Constantes partagées avec le circuit circuits/src/bari_invoice.circom : à modifier ensemble, puis relancer zk:setup.

import { fileURLToPath } from "node:url";

/** Encode une étiquette ASCII en entier big-endian (convention des domaines de séparation du circuit). */
function asciiToField(label: string): bigint {
  return BigInt(`0x${Buffer.from(label, "ascii").toString("hex")}`);
}

/** Domaine de séparation de l'empreinte N = Poseidon(DOMAIN_N, uuid). */
export const DOMAIN_N = asciiToField("bari.nullifier.v1");
/** Domaine de séparation du pseudonyme P = Poseidon(DOMAIN_P, Ax, Ay, millésime). */
export const DOMAIN_P = asciiToField("bari.pseudonym.v1");

/** Profondeur fixe de l'arbre de Merkle des débiteurs : 2^8 = 256 débiteurs par liste. */
export const MERKLE_DEPTH = 8;
/** Valeur des feuilles vides de l'arbre. */
export const EMPTY_LEAF = 0n;
/** Largeur en bits des montants et du seuil (Num2Bits(64) dans le circuit). */
export const AMOUNT_BITS = 64;

/** Un élément du corps BN254 sérialisé : 32 octets big-endian. */
export const FIELD_BYTES = 32;
/** Taille d'un AccountID XRPL. */
export const ACCOUNT_ID_BYTES = 20;
/** uuid = 31 premiers octets du HMAC-SHA256 : 248 bits, toujours inférieur au module de BN254. */
export const UUID_BYTES = 31;
/** Aléa r de l'engagement : 31 octets, toujours dans le corps. */
export const BLINDING_BYTES = 31;

/** Secret de démo nommé, public, dont dérivent les clés des débiteurs simulés. Jamais en production. */
export const DEMO_DEBTOR_SECRET = "bari-demo-debiteur-secret-non-confidentiel";

const ARTIFACTS_DIR = new URL("../../circuits/artifacts/", import.meta.url);
const BUILD_DIR = new URL("../../circuits/build/", import.meta.url);

/** Artefacts produits par `npm run zk:setup`. */
export const CIRCUIT_WASM_PATH = fileURLToPath(new URL("bari_invoice.wasm", ARTIFACTS_DIR));
export const VERIFICATION_KEY_PATH = fileURLToPath(new URL("verification_key.json", ARTIFACTS_DIR));
export const PROVING_KEY_PATH = fileURLToPath(new URL("bari_invoice_final.zkey", BUILD_DIR));
