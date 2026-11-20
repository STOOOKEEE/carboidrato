// Détail d'une transaction lu sur le nœud, puisque l'AlphaNet n'a pas d'explorer : comptes, champs clés, objets
// créés, transactions internes d'un Batch et, pour un MPT facture, le certificat décodé de ses métadonnées.

import type { FastifyInstance } from "fastify";
import { hashes, type Transaction } from "xrpl";
import { explorerTransactionUrl } from "../../../config/network.js";
import { decodeCertificateMetadata } from "../../../invoice/certificateMetadata.js";
import type { LedgerTransaction } from "../../../xrpl/ledger.js";
import type { TxCertificate, TxDetail } from "../../contract.js";
import type { ApiContext } from "../context.js";
import { HttpError } from "../errors.js";

const HTTP_NOT_FOUND = 404;

/** Champs qui désignent un compte, dans l'ordre d'affichage. */
const ACCOUNT_FIELDS = ["Account", "Destination", "Subject", "Issuer", "Counterparty", "Borrower", "Holder", "Owner"];
/** Champs techniques ou trop longs pour les faits clés (ils restent dans la transaction brute). */
const HIDDEN_FIELDS = new Set([
  "TransactionType",
  "Flags",
  "Sequence",
  "TicketSequence",
  "LastLedgerSequence",
  "NetworkID",
  "SigningPubKey",
  "TxnSignature",
  "Signers",
  "BatchSigners",
  "RawTransactions",
  "Memos",
  "MPTokenMetadata",
  "date",
  "ledger_index",
  "hash",
  "ctid",
]);

interface TxParams {
  hash: string;
}

const txParamsSchema = {
  params: {
    type: "object",
    required: ["hash"],
    properties: { hash: { type: "string", pattern: "^[0-9A-Fa-f]{64}$" } },
  },
} as const;

/** Montant XRPL lisible : drops, ou objet { value, currency | mpt_issuance_id }. */
function fieldValue(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object" && value !== null && "value" in value) {
    const unit = "currency" in value ? value.currency : "mpt_issuance_id" in value ? value.mpt_issuance_id : undefined;
    return `${String(value.value)}${unit === undefined ? "" : ` ${String(unit)}`}`;
  }
  return undefined;
}

function keyFields(tx: Transaction): TxDetail["fields"] {
  return Object.entries(tx).flatMap(([name, raw]) => {
    if (HIDDEN_FIELDS.has(name) || ACCOUNT_FIELDS.includes(name)) return [];
    const value = fieldValue(raw);
    return value === undefined ? [] : [{ name, value }];
  });
}

function accounts(tx: Transaction): TxDetail["accounts"] {
  const values = new Map(Object.entries(tx));
  return ACCOUNT_FIELDS.flatMap((role) => {
    const address = values.get(role);
    return typeof address === "string" ? [{ role, address }] : [];
  });
}

function innerTransactions(tx: Transaction): Transaction[] {
  return tx.TransactionType === "Batch" ? tx.RawTransactions.map(({ RawTransaction }) => RawTransaction) : [];
}

/** Premier MPT facture Bari créé par la transaction ou l'une de ses transactions internes. */
function invoiceCertificate(candidates: readonly Transaction[]): TxCertificate | undefined {
  for (const candidate of candidates) {
    if (candidate.TransactionType !== "MPTokenIssuanceCreate" || candidate.MPTokenMetadata === undefined) continue;
    try {
      const { proof: _proof, ...certificate } = decodeCertificateMetadata(candidate.MPTokenMetadata);
      return certificate;
    } catch {
      // Métadonnées d'un autre MPT : pas un certificat Bari.
    }
  }
  return undefined;
}

function txDetail(result: LedgerTransaction, explorerUrl: string | undefined): TxDetail {
  const tx = result.tx_json;
  const meta = typeof result.meta === "object" ? result.meta : undefined;
  const inner = innerTransactions(tx);
  return {
    hash: result.hash,
    type: tx.TransactionType,
    result: meta?.TransactionResult,
    validated: result.validated === true,
    ledgerIndex: result.ledger_index,
    closeTime: result.close_time_iso,
    accounts: accounts(tx),
    fields: keyFields(tx),
    createdObjects: (meta?.AffectedNodes ?? []).flatMap((node) =>
      "CreatedNode" in node ? [{ type: node.CreatedNode.LedgerEntryType, index: node.CreatedNode.LedgerIndex }] : [],
    ),
    innerTransactions: inner.map((innerTx) => ({
      hash: hashes.hashSignedTx(innerTx),
      type: innerTx.TransactionType,
      account: innerTx.Account,
    })),
    certificate: invoiceCertificate([tx, ...inner]),
    explorerUrl,
    raw: { tx, meta: result.meta },
  };
}

export function registerTxRoutes(app: FastifyInstance, context: Pick<ApiContext, "ledger" | "network">): void {
  app.get<{ Params: TxParams }>("/api/tx/:hash", { schema: txParamsSchema }, async (request) => {
    const hash = request.params.hash.toUpperCase();
    const result = await context.ledger.transaction(hash);
    if (result === undefined) throw new HttpError(HTTP_NOT_FOUND, `Transaction inconnue du nœud : ${hash}`);
    return txDetail(result, explorerTransactionUrl(context.network, hash));
  });
}
