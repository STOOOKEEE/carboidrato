// Champ Data du LoanSet : la référence publique du prêt à son certificat (IDEE §5 point 4).
//
// Encodage compact, binaire, 89 octets (limite ledger : 256) :
//   octet 0       version (0x01)
//   octets 1-32   N, empreinte de la facture (32 octets, big-endian)
//   octets 33-56  ID du MPT facture (MPTokenIssuanceID, 24 octets)
//   octets 57-88  P, pseudonyme du débiteur (32 octets, big-endian)
// Le Loan ne stocke pas ce champ : l'audit le relit dans la transaction LoanSet qui a créé le prêt.

import { assertHash32 } from "../invoice/registry.js";

const LOAN_DATA_VERSION = "01";
const VERSION_HEX_LENGTH = 2;
const HASH_32_HEX_LENGTH = 64;
const MPT_ID_HEX_LENGTH = 48;
const LOAN_DATA_HEX_LENGTH = VERSION_HEX_LENGTH + HASH_32_HEX_LENGTH + MPT_ID_HEX_LENGTH + HASH_32_HEX_LENGTH;
const MPT_ID_PATTERN = new RegExp(`^[0-9A-F]{${MPT_ID_HEX_LENGTH}}$`);

export interface LoanReference {
  nullifier: string;
  invoiceTokenId: string;
  pseudonym: string;
}

export function encodeLoanData({ nullifier, invoiceTokenId, pseudonym }: LoanReference): string {
  assertHash32(nullifier, "Empreinte N");
  assertHash32(pseudonym, "Pseudonyme P");
  const tokenId = invoiceTokenId.toUpperCase();
  if (!MPT_ID_PATTERN.test(tokenId)) throw new Error(`ID de MPT facture invalide : ${invoiceTokenId}`);
  return `${LOAN_DATA_VERSION}${nullifier}${tokenId}${pseudonym}`;
}

/** Lève une erreur si Data n'est pas une référence Bari v1. */
export function decodeLoanData(dataHex: string | undefined): LoanReference {
  const hex = dataHex?.toUpperCase();
  if (hex === undefined || hex.length !== LOAN_DATA_HEX_LENGTH || !hex.startsWith(LOAN_DATA_VERSION)) {
    throw new Error("Data du LoanSet : pas une référence Bari v1");
  }
  const tokenStart = VERSION_HEX_LENGTH + HASH_32_HEX_LENGTH;
  const pseudonymStart = tokenStart + MPT_ID_HEX_LENGTH;
  const reference = {
    nullifier: hex.slice(VERSION_HEX_LENGTH, tokenStart),
    invoiceTokenId: hex.slice(tokenStart, pseudonymStart),
    pseudonym: hex.slice(pseudonymStart),
  };
  encodeLoanData(reference); // valide le format des trois champs
  return reference;
}
