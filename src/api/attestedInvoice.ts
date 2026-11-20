// Fichier de facture attestée (.bari.json) : validation d'une entrée inconnue, conversion vers l'attestation
// du circuit, et sérialisation (factures d'exemple). Messages d'erreur en anglais : ils sont affichés par le front.

import { isValidClassicAddress } from "xrpl";
import { accountToField, fieldToAccount, fromHex, toHex32, type DebtorAttestation } from "../zk/index.js";
import { ATTESTED_INVOICE_FORMAT, type AttestedInvoiceFile } from "./contract.js";

export class InvalidInvoiceFile extends Error {}

type JsonObject = Record<string, unknown>;

const DECIMAL_PATTERN = /^\d+$/;

function asObject(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidInvoiceFile(`missing or invalid ${label}`);
  }
  return value as JsonObject;
}

function readString(object: JsonObject, key: string): string {
  const value = object[key];
  if (typeof value !== "string" || value.trim() === "") throw new InvalidInvoiceFile(`missing field "${key}"`);
  return value;
}

function readDecimal(object: JsonObject, key: string): string {
  const value = readString(object, key);
  if (!DECIMAL_PATTERN.test(value)) throw new InvalidInvoiceFile(`field "${key}" must be a decimal integer`);
  return value;
}

function readAddress(object: JsonObject, key: string): string {
  const value = readString(object, key);
  if (!isValidClassicAddress(value)) throw new InvalidInvoiceFile(`field "${key}" is not a valid XRPL address`);
  return value;
}

/** Valide la structure d'un fichier déposé ; les contrôles cryptographiques viennent ensuite. */
export function parseAttestedInvoice(input: unknown): AttestedInvoiceFile {
  const root = asObject(input, "file");
  if (root.format !== ATTESTED_INVOICE_FORMAT) {
    throw new InvalidInvoiceFile(`unknown format (expected ${ATTESTED_INVOICE_FORMAT})`);
  }
  const invoice = asObject(root.invoice, "invoice");
  const attestation = asObject(root.attestation, "attestation");
  const publicKey = asObject(attestation.debtorPublicKey, "debtorPublicKey");
  const signature = asObject(attestation.signature, "signature");
  const networkId = attestation.networkId;
  if (typeof networkId !== "number" || !Number.isInteger(networkId) || networkId < 0) {
    throw new InvalidInvoiceFile('invalid field "networkId"');
  }
  return {
    format: ATTESTED_INVOICE_FORMAT,
    invoice: {
      number: readString(invoice, "number"),
      debtorName: readString(invoice, "debtorName"),
      description: readString(invoice, "description"),
      issueDate: readString(invoice, "issueDate"),
    },
    attestation: {
      account: readAddress(attestation, "account"),
      amountCents: readDecimal(attestation, "amountCents"),
      dueDate: readDecimal(attestation, "dueDate"),
      networkId,
      registry: readAddress(attestation, "registry"),
      uuid: readString(attestation, "uuid"),
      debtorPublicKey: { ax: readDecimal(publicKey, "ax"), ay: readDecimal(publicKey, "ay") },
      signature: {
        r8x: readDecimal(signature, "r8x"),
        r8y: readDecimal(signature, "r8y"),
        s: readDecimal(signature, "s"),
      },
    },
  };
}

/** Attestation au format du circuit (entiers du corps), hors message : il est toujours recalculé. */
export function toCircuitAttestation(file: AttestedInvoiceFile): Omit<DebtorAttestation, "message"> {
  const { attestation } = file;
  try {
    return {
      account: accountToField(attestation.account),
      amount: BigInt(attestation.amountCents),
      dueDate: BigInt(attestation.dueDate),
      networkId: BigInt(attestation.networkId),
      registry: accountToField(attestation.registry),
      uuid: fromHex(attestation.uuid),
      debtorPublicKey: { ax: BigInt(attestation.debtorPublicKey.ax), ay: BigInt(attestation.debtorPublicKey.ay) },
      signature: {
        r8x: BigInt(attestation.signature.r8x),
        r8y: BigInt(attestation.signature.r8y),
        s: BigInt(attestation.signature.s),
      },
    };
  } catch (error) {
    throw new InvalidInvoiceFile(`unreadable attestation: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export interface InvoiceDisplay {
  number: string;
  debtorName: string;
  description: string;
  issueDate: Date;
}

/** Sérialise une facture et l'attestation de son débiteur (comptes en adresses r…). */
export function toAttestedInvoiceFile(invoice: InvoiceDisplay, attestation: DebtorAttestation): AttestedInvoiceFile {
  return {
    format: ATTESTED_INVOICE_FORMAT,
    invoice: {
      number: invoice.number,
      debtorName: invoice.debtorName,
      description: invoice.description,
      issueDate: invoice.issueDate.toISOString(),
    },
    attestation: {
      account: fieldToAccount(attestation.account),
      amountCents: attestation.amount.toString(),
      dueDate: attestation.dueDate.toString(),
      networkId: Number(attestation.networkId),
      registry: fieldToAccount(attestation.registry),
      uuid: toHex32(attestation.uuid),
      debtorPublicKey: {
        ax: attestation.debtorPublicKey.ax.toString(),
        ay: attestation.debtorPublicKey.ay.toString(),
      },
      signature: {
        r8x: attestation.signature.r8x.toString(),
        r8y: attestation.signature.r8y.toString(),
        s: attestation.signature.s.toString(),
      },
    },
  };
}
