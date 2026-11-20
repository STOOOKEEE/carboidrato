// MPT facture : 1 unité par facture, sans CanTransfer (ne circule qu'entre la PME émettrice et Bari).
// L'émission n'est jamais détruite : le certificat et sa preuve restent lisibles pour l'audit.

import {
  decodeAccountID,
  MPTokenAuthorizeFlags,
  type Client,
  type MPTokenAuthorize,
  type MPTokenIssuanceCreate,
  type Payment,
  type Wallet,
} from "xrpl";
import { mptAmount, sendMpt } from "../xrpl/mpt.js";
import { submitTx } from "../xrpl/submit.js";

export const INVOICE_TOKEN_SUPPLY = 1n;
const INVOICE_TOKEN_SCALE = 0;
const SEQUENCE_BYTES = 4;
const MAX_SEQUENCE = 0xffffffff;

export function invoiceTokenIssuanceTx(sme: string, metadataHex: string): MPTokenIssuanceCreate {
  return {
    TransactionType: "MPTokenIssuanceCreate",
    Account: sme,
    MaximumAmount: INVOICE_TOKEN_SUPPLY.toString(),
    AssetScale: INVOICE_TOKEN_SCALE,
    MPTokenMetadata: metadataHex,
  };
}

/**
 * Identifiant d'une émission MPT, connu avant sa création (IDEE §6) :
 * séquence de la transaction MPTokenIssuanceCreate (4 octets big-endian) ‖ AccountID de l'émetteur (20 octets).
 */
export function invoiceTokenId(issuer: string, issuanceSequence: number): string {
  if (!Number.isInteger(issuanceSequence) || issuanceSequence < 0 || issuanceSequence > MAX_SEQUENCE) {
    throw new Error(`Séquence d'émission MPT invalide : ${issuanceSequence}`);
  }
  const sequence = Buffer.alloc(SEQUENCE_BYTES);
  sequence.writeUInt32BE(issuanceSequence);
  return Buffer.concat([sequence, Buffer.from(decodeAccountID(issuer))]).toString("hex").toUpperCase();
}

/** Remise à Bari : Bari ouvre son MPToken, puis la PME lui envoie l'unité. */
export function invoiceTokenHandoverTxs(tokenId: string, sme: string, bari: string): [MPTokenAuthorize, Payment] {
  return [
    { TransactionType: "MPTokenAuthorize", Account: bari, MPTokenIssuanceID: tokenId },
    {
      TransactionType: "Payment",
      Account: sme,
      Destination: bari,
      Amount: mptAmount(tokenId, INVOICE_TOKEN_SUPPLY),
    },
  ];
}

/** Après remboursement : retour à la PME émettrice (l'unité est brûlée) et fermeture du MPToken de Bari. */
export async function returnInvoiceToken(client: Client, tokenId: string, sme: Wallet, bari: Wallet): Promise<void> {
  await sendMpt(client, tokenId, bari, sme.address, INVOICE_TOKEN_SUPPLY, "Payment MPT facture bari → sme");
  await submitTx(
    client,
    {
      TransactionType: "MPTokenAuthorize",
      Account: bari.address,
      MPTokenIssuanceID: tokenId,
      Flags: MPTokenAuthorizeFlags.tfMPTUnauthorize,
    },
    bari,
    "MPTokenAuthorize unauthorize (bari)",
  );
}
