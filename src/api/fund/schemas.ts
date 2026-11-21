// Schémas des requêtes (validés par Fastify) et types TypeScript correspondants.

import { LEDGER_MIN_INVESTMENT_PERIOD_S } from "../../config/cohort.js";
import { VERIFIED_DEBTORS } from "../../invoice/debtors.js";
import { PUBLIC_SIGNAL_ORDER, type InvoiceProof } from "../../zk/index.js";

/** Bornes raisonnables pour une démo : une journée de souscription, une semaine d'investissement. */
const MAX_SUBSCRIPTION_WINDOW_S = 86_400;
const MAX_INVESTMENT_PERIOD_S = 7 * 86_400;
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

const EMAIL_PATTERN = "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$";
const MAX_EMAIL_LENGTH = 254;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;
const COUNTRY_PATTERN = "^[A-Z]{2}$";
/** Préfixe pays puis 2 à 13 caractères, espaces tolérés (normalisés à l'enregistrement). */
const VAT_PATTERN = "^\\s*[A-Za-z]{2}[0-9A-Za-z ]{2,20}$";
const IPA_CODES = VERIFIED_DEBTORS.map((debtor) => debtor.ipaCode);

const credentials = {
  email: { type: "string", pattern: EMAIL_PATTERN, maxLength: MAX_EMAIL_LENGTH },
  password: { type: "string", minLength: MIN_PASSWORD_LENGTH, maxLength: MAX_PASSWORD_LENGTH },
} as const;
const companyField = { type: "string", minLength: 1, maxLength: MAX_COMPANY_FIELD_LENGTH } as const;

function profileSchema(properties: Record<string, object>) {
  return { type: "object", additionalProperties: false, required: Object.keys(properties), properties } as const;
}

const lenderProfile = profileSchema({
  name: companyField,
  country: { type: "string", pattern: COUNTRY_PATTERN },
  riskAcknowledged: { type: "boolean", const: true },
});
const businessProfile = profileSchema({ company: companyField, vatNumber: { type: "string", pattern: VAT_PATTERN } });

/** Un rôle et son profil (KYC léger), plus les champs d'identification du formulaire (`base`). */
function profileVariant(base: Record<string, object>, role: string, profile: object) {
  return {
    type: "object",
    additionalProperties: false,
    required: [...Object.keys(base), "role", "profile"],
    properties: { ...base, role: { type: "string", const: role }, profile },
  } as const;
}

export const signupSchema = {
  body: {
    oneOf: [
      profileVariant(credentials, "lender", lenderProfile),
      profileVariant(credentials, "business", businessProfile),
      profileVariant(credentials, "public_body", profileSchema({ ipaCode: { type: "string", enum: IPA_CODES } })),
    ],
  },
} as const;

export const signinSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["email", "password"],
    properties: {
      email: { type: "string", minLength: 1, maxLength: MAX_EMAIL_LENGTH },
      password: { type: "string", minLength: 1, maxLength: MAX_PASSWORD_LENGTH },
    },
  },
} as const;

/** Adresse classique : `r` puis 24 à 34 caractères base58 (somme de contrôle vérifiée par la route). */
const CLASSIC_ADDRESS_PATTERN = "^r[1-9A-HJ-NP-Za-km-z]{24,34}$";
/** Un AccountSet signé avec un mémo tient en quelques centaines d'octets. */
const MAX_TX_BLOB_HEX = 4_096;
const MAX_TOKEN_LENGTH = 256;

export const walletChallengeSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["address"],
    properties: { address: { type: "string", pattern: CLASSIC_ADDRESS_PATTERN } },
  },
} as const;

export const walletVerifySchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["tx_blob"],
    properties: { tx_blob: { type: "string", pattern: "^([0-9A-Fa-f]{2})+$", maxLength: MAX_TX_BLOB_HEX } },
  },
} as const;

const registrationToken = { token: { type: "string", minLength: 1, maxLength: MAX_TOKEN_LENGTH } } as const;

/** Mêmes profils que l'inscription par email ; pas d'organisme public : il n'a pas de compte XRPL. */
export const walletRegisterSchema = {
  body: {
    oneOf: [
      profileVariant(registrationToken, "lender", lenderProfile),
      profileVariant(registrationToken, "business", businessProfile),
    ],
  },
} as const;

/** Un Batch signé de trois transactions internes tient en moins de 2 Ko. */
const MAX_ONBOARDING_BLOB_HEX = 16_384;

export const onboardingSubmitSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["tx_blob"],
    properties: { tx_blob: { type: "string", pattern: "^([0-9A-Fa-f]{2})+$", maxLength: MAX_ONBOARDING_BLOB_HEX } },
  },
} as const;

export interface VatParams {
  vat: string;
}

export const vatParamsSchema = {
  params: { type: "object", required: ["vat"], properties: { vat: { type: "string", pattern: VAT_PATTERN } } },
} as const;

// Espace prêteur : montant d'un dépôt (unités RLUSD) ou d'un retrait (unités de part), entier strictement positif.

const MAX_UNITS_DIGITS = 30;

export const lenderTradeSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["amount"],
    properties: { amount: { type: "string", pattern: "^[1-9][0-9]*$", maxLength: MAX_UNITS_DIGITS } },
  },
} as const;
