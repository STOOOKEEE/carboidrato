// Fiche publique du fonds, stockée dans le champ Data du Vault (≤ 256 octets, JSON lisible dans l'explorer).
//
// Pourquoi le Data du Vault pour la racine Merkle des débiteurs vérifiés : c'est un attribut du fonds (la liste
// fixe le niveau de risque de ses créances), tout investisseur ou auditeur le lit en un seul ledger_entry à
// partir de l'ID du Vault qu'il connaît déjà, et seul le propriétaire du Vault peut le changer (VaultSet),
// changement visible dans l'historique. Un credential dédié obligerait à connaître émetteur, sujet et type.
// On y joint les autres entrées publiques propres au fonds : millésime (portée de P) et compte registre.

import { convertHexToString } from "xrpl";
import { hexByteLength, textToHex } from "../lib/encoding.js";

const MANIFEST_APP = "bari";
const MANIFEST_VERSION = 1;
/** Limite ledger du champ Data d'un Vault. */
const MAX_VAULT_DATA_BYTES = 256;

export interface FundManifest {
  /** Racine Merkle de la liste des débiteurs vérifiés. */
  debtorsRoot: string;
  vintage: number;
  /** Compte registre de Bari (sujet des credentials N). */
  registry: string;
}

export function encodeFundManifest(manifest: FundManifest): string {
  const hex = textToHex(
    JSON.stringify({
      app: MANIFEST_APP,
      v: MANIFEST_VERSION,
      root: manifest.debtorsRoot,
      vintage: manifest.vintage,
      registry: manifest.registry,
    }),
  );
  if (hexByteLength(hex) > MAX_VAULT_DATA_BYTES) {
    throw new Error(`Fiche du fonds trop longue (${hexByteLength(hex)} o > ${MAX_VAULT_DATA_BYTES})`);
  }
  return hex;
}

/** Relit la fiche depuis le Data du Vault ; lève une erreur si ce n'est pas un fonds Bari. */
export function decodeFundManifest(dataHex: string | undefined): FundManifest {
  if (dataHex === undefined) throw new Error("Vault sans Data : pas un fonds Bari");
  const parsed: unknown = JSON.parse(convertHexToString(dataHex));
  if (typeof parsed !== "object" || parsed === null) throw new Error("Data du Vault illisible");
  const { app, v, root, vintage, registry } = parsed as Record<string, unknown>;
  if (app !== MANIFEST_APP || v !== MANIFEST_VERSION) throw new Error("Data du Vault : pas une fiche Bari v1");
  if (typeof root !== "string" || typeof vintage !== "number" || typeof registry !== "string") {
    throw new Error("Data du Vault : fiche Bari incomplète");
  }
  return { debtorsRoot: root, vintage, registry };
}
