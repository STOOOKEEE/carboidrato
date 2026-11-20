// Liste des débiteurs vérifiés par Bari (administrations), dont la racine Merkle est publiée on-chain.
// Données de démo : les clés d'attestation de chaque débiteur sont dérivées de son nom par src/zk (deriveDebtor) ;
// en production, chaque débiteur garde son secret HMAC et sa clé EdDSA.

export interface VerifiedDebtor {
  name: string;
  /** Code IPA (identifiant officiel des administrations italiennes). */
  ipaCode: string;
}

export const VERIFIED_DEBTORS: readonly VerifiedDebtor[] = [
  { name: "Comune di Bari", ipaCode: "c_a662" },
  { name: "Comune di Lecce", ipaCode: "c_e506" },
  { name: "Regione Puglia", ipaCode: "r_puglia" },
];

/** Débiteur de la démo : la mairie de Bari. */
export const DEMO_DEBTOR = VERIFIED_DEBTORS[0];
