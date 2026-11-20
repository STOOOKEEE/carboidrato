// Lecture d'objets du ledger validé par leur identifiant (ledger_entry), sans scan d'historique.

import { createHash } from "node:crypto";
import {
  decodeAccountID,
  type AccountObjectsRequest,
  type Client,
  type LedgerEntry,
  type LedgerEntryRequest,
  type LedgerEntryResponse,
} from "xrpl";
import { parseUnits } from "../lib/amounts.js";
import { rippledErrorCode } from "./rippledError.js";

/** Espace de noms des credentials dans les index du ledger (`LedgerNameSpace::Credential = 'D'`). */
const CREDENTIAL_NAMESPACE = 0x0044;
const LEDGER_INDEX_BYTES = 32;
/** Flag lsfAccepted d'un objet Credential. */
const LSF_CREDENTIAL_ACCEPTED = 0x00010000;

async function fetchEntry<T>(
  client: Client,
  request: Omit<LedgerEntryRequest, "command" | "ledger_index">,
): Promise<T | undefined> {
  try {
    const response = await client.request<LedgerEntryRequest, typeof client.apiVersion, LedgerEntryResponse<T>>({
      command: "ledger_entry",
      ledger_index: "validated",
      ...request,
    });
    return response.result.node;
  } catch (error) {
    if (rippledErrorCode(error) === "entryNotFound") return undefined;
    throw error;
  }
}

async function requireEntry<T>(client: Client, index: string, kind: string): Promise<T> {
  const entry = await fetchEntry<T>(client, { index });
  if (entry === undefined) throw new Error(`${kind} introuvable : ${index}`);
  return entry;
}

export const getVault = (client: Client, vaultId: string) =>
  requireEntry<LedgerEntry.Vault>(client, vaultId, "Vault");

export const getLoanBroker = (client: Client, brokerId: string) =>
  requireEntry<LedgerEntry.LoanBroker>(client, brokerId, "LoanBroker");

export const getLoan = (client: Client, loanId: string) =>
  requireEntry<LedgerEntry.Loan>(client, loanId, "Loan");

/** Objet quelconque par son index, ou undefined s'il n'existe pas. */
export const findEntry = (client: Client, index: string) =>
  fetchEntry<LedgerEntry.LedgerEntry>(client, { index });

export const getMptIssuance = (client: Client, issuanceId: string) =>
  fetchEntry<LedgerEntry.MPTokenIssuance>(client, { mpt_issuance: issuanceId });

/** Tous les objets d'un type possédés par un compte (pagination incluse). */
export async function listAccountObjects(
  client: Client,
  account: string,
  type: AccountObjectsRequest["type"],
): Promise<LedgerEntry.LedgerEntry[]> {
  const objects: LedgerEntry.LedgerEntry[] = [];
  let marker: unknown;
  do {
    const response = await client.request({
      command: "account_objects",
      account,
      type,
      ledger_index: "validated",
      ...(marker === undefined ? {} : { marker }),
    });
    objects.push(...response.result.account_objects);
    marker = response.result.marker;
  } while (marker !== undefined);
  return objects;
}

/**
 * Index d'un credential = SHA-512Half(namespace ‖ sujet ‖ émetteur ‖ type), comme `keylet::credential` dans rippled.
 * On le calcule nous-mêmes : le type `credential` de LedgerEntryRequest dans xrpl.js attend `credentialType`
 * alors que rippled lit `credential_type`.
 */
export function credentialIndex(subject: string, issuer: string, credentialTypeHex: string): string {
  const namespace = Buffer.alloc(2);
  namespace.writeUInt16BE(CREDENTIAL_NAMESPACE);
  const payload = Buffer.concat([
    namespace,
    Buffer.from(decodeAccountID(subject)),
    Buffer.from(decodeAccountID(issuer)),
    Buffer.from(credentialTypeHex, "hex"),
  ]);
  return createHash("sha512").update(payload).digest().subarray(0, LEDGER_INDEX_BYTES).toString("hex").toUpperCase();
}

export const getCredential = (client: Client, subject: string, issuer: string, credentialTypeHex: string) =>
  fetchEntry<LedgerEntry.Credential>(client, { index: credentialIndex(subject, issuer, credentialTypeHex) });

export function isCredentialAccepted(credential: LedgerEntry.Credential): boolean {
  return typeof credential.Flags === "number" && (credential.Flags & LSF_CREDENTIAL_ACCEPTED) !== 0;
}

/** Solde MPT d'un compte (0 s'il n'a pas d'objet MPToken). */
export async function getMptBalance(client: Client, issuanceId: string, account: string): Promise<bigint> {
  const token = await fetchEntry<LedgerEntry.MPToken>(client, {
    mptoken: { mpt_issuance_id: issuanceId, account },
  });
  return parseUnits(token?.MPTAmount);
}

/** Solde XRP en drops, ou undefined si le compte n'existe pas. */
export async function getXrpBalanceDrops(client: Client, account: string): Promise<bigint | undefined> {
  const root = await fetchEntry<LedgerEntry.AccountRoot>(client, { account_root: account });
  return root === undefined ? undefined : BigInt(root.Balance);
}
