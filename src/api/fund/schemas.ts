// Schémas des requêtes (validés par Fastify) et types TypeScript correspondants.

import { LEDGER_MIN_INVESTMENT_PERIOD_S } from "../../config/cohort.js";
import { VERIFIED_DEBTORS } from "../../invoice/debtors.js";
import { PUBLIC_SIGNAL_ORDER, type InvoiceProof } from "../../zk/index.js";

/** Bornes raisonnables pour une démo : une journée de souscription, une semaine d'investissement. */
const MAX_SUBSCRIPTION_WINDOW_S = 86_400;
const MAX_INVESTMENT_PERIOD_S = 7 * 86_400;
const MAX_INVOICE_NUMBER_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 200;
/** Plafond d'une facture attestée en démo (le montant tient largement sur les 64 bits du circuit). */
const MAX_INVOICE_AMOUNT_EUR = 10_000_000;
const DECIMAL_PATTERN = "^[0-9]+$";
const HASH_32_PATTERN = "^[0-9A-Fa-f]{64}$";
const MPT_ID_PATTERN = "^[0-9A-Fa-f]{48}$";
const G1_POINT_COORDINATES = 3;
const G2_POINT_ROWS = 3;
const G2_POINT_COORDINATES = 2;

export const DEBTOR_NAMES = VERIFIED_DEBTORS.map((debtor) => debtor.name);

const decimalString = { type: "string", pattern: DECIMAL_PATTERN } as const;
const decimalArray = (length: number) =>
  ({ type: "array", items: decimalString, minItems: length, maxItems: length }) as const;

export interface CreateFundBody {
  subscriptionWindowS?: number;
  investmentPeriodS?: number;
  /** Remplace le fonds courant s'il existe. */
  replace?: boolean;
}

export const createFundSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    properties: {
      subscriptionWindowS: { type: "integer", minimum: 1, maximum: MAX_SUBSCRIPTION_WINDOW_S },
      investmentPeriodS: { type: "integer", minimum: LEDGER_MIN_INVESTMENT_PERIOD_S, maximum: MAX_INVESTMENT_PERIOD_S },
      replace: { type: "boolean" },
    },
  },
} as const;

export interface AttestBody {
  invoiceNumber: string;
  amountEur: number;
  /** Échéance, date ISO (« 2027-02-18 » ou date-heure). */
  dueDate: string;
  smeAccount: string;
  debtorName?: string;
  description?: string;
}

export const attestSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["invoiceNumber", "amountEur", "dueDate", "smeAccount"],
    properties: {
      invoiceNumber: { type: "string", minLength: 1, maxLength: MAX_INVOICE_NUMBER_LENGTH },
      amountEur: { type: "number", exclusiveMinimum: 0, maximum: MAX_INVOICE_AMOUNT_EUR },
      dueDate: { type: "string", minLength: 1 },
      smeAccount: { type: "string", minLength: 1 },
      debtorName: { type: "string", enum: DEBTOR_NAMES },
      description: { type: "string", maxLength: MAX_DESCRIPTION_LENGTH },
    },
  },
} as const;

export interface DebtorPathQuery {
  debtor: string;
}

export const debtorPathSchema = {
  querystring: {
    type: "object",
    required: ["debtor"],
    properties: { debtor: { type: "string", enum: DEBTOR_NAMES } },
  },
} as const;

/** Facture attestée (format bari.attested-invoice.v1) : la structure est validée par parseAttestedInvoice. */
export const attestedInvoiceSchema = { body: { type: "object" } } as const;

export type CertificateBody = InvoiceProof;

export const certificateSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["proof", "publicSignals"],
    properties: {
      proof: {
        type: "object",
        additionalProperties: false,
        required: ["pi_a", "pi_b", "pi_c", "protocol", "curve"],
        properties: {
          pi_a: decimalArray(G1_POINT_COORDINATES),
          pi_b: {
            type: "array",
            items: decimalArray(G2_POINT_COORDINATES),
            minItems: G2_POINT_ROWS,
            maxItems: G2_POINT_ROWS,
          },
          pi_c: decimalArray(G1_POINT_COORDINATES),
          protocol: { type: "string", const: "groth16" },
          curve: { type: "string", const: "bn128" },
        },
      },
      publicSignals: decimalArray(PUBLIC_SIGNAL_ORDER.length),
    },
  },
} as const;

const MAX_COMPANY_FIELD_LENGTH = 120;

export const kybSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["account", "company", "vatNumber"],
    properties: {
      account: { type: "string", minLength: 1 },
      company: { type: "string", minLength: 1, maxLength: MAX_COMPANY_FIELD_LENGTH },
      vatNumber: { type: "string", minLength: 1, maxLength: MAX_COMPANY_FIELD_LENGTH },
    },
  },
} as const;

export interface AccountParams {
  account: string;
}

export const accountParamsSchema = {
  params: { type: "object", required: ["account"], properties: { account: { type: "string", minLength: 1 } } },
} as const;

export interface RegistryParams {
  nullifier: string;
}

export interface RegistryQuery {
  account: string;
}

export const registrySchema = {
  params: { type: "object", required: ["nullifier"], properties: { nullifier: { type: "string", pattern: HASH_32_PATTERN } } },
  querystring: { type: "object", required: ["account"], properties: { account: { type: "string", minLength: 1 } } },
} as const;

export interface OfferQuery {
  /** Échéance ISO de la facture (publique : c'est un signal de la preuve). */
  dueDate: string;
}

export const offerSchema = {
  querystring: { type: "object", required: ["dueDate"], properties: { dueDate: { type: "string", minLength: 1 } } },
} as const;

export interface LoanBody {
  tokenId: string;
}

export const loanSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["tokenId"],
    properties: { tokenId: { type: "string", pattern: MPT_ID_PATTERN } },
  },
} as const;

export interface LoanParams {
  id: string;
}

export const loanParamsSchema = {
  params: {
    type: "object",
    required: ["id"],
    properties: { id: { type: "string", pattern: HASH_32_PATTERN } },
  },
} as const;
