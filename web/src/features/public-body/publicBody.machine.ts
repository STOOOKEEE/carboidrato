// Parcours de l'organisme public, pur : fichier lu, champs (formulaire si besoin), fournisseur retrouvé, signature.

import { ATTESTED_INVOICE_EXTENSION, type AttestedInvoiceFile, type BusinessLookup } from "../../../../src/api/contract";
import { currencyRefusal, decimalToCents, isIsoDate, type FatturaReading } from "./fatturaPA";

export type InvoiceField = "vatNumber" | "number" | "issueDate" | "amount" | "dueDate";
export type InvoiceForm = Record<InvoiceField, string>;
export type FieldErrors = Partial<Record<InvoiceField, string>>;

/** Facture prête à signer : TVA normalisée, montant exact en centimes, dates AAAA-MM-JJ. */
export interface InvoiceDraft {
  vatNumber: string;
  number: string;
  issueDate: string;
  amountCents: bigint;
  dueDate: string;
  description: string;
}

export type FormValidation = { ok: true; draft: InvoiceDraft } | { ok: false; errors: FieldErrors };

export type SupplierState =
  | { status: "none" }
  | { status: "looking"; vat: string }
  | { status: "found"; vat: string; business: BusinessLookup }
  | { status: "unknown"; vat: string }
  | { status: "failed"; vat: string; message: string };

/** `fatturapa` : tout lu, en lecture seule ; `partial` : FatturaPA incomplète ; `other` : autre fichier, à saisir. */
export type InvoiceSource = "fatturapa" | "partial" | "other";

interface Review {
  fileName: string;
  source: InvoiceSource;
  form: InvoiceForm;
  description: string;
  errors: FieldErrors;
  supplier: SupplierState;
  signError?: string;
}

export type ReviewState = { status: "review" } & Review;

export type PublicBodyState =
  | { status: "empty"; refusal?: string }
  | ReviewState
  | ({ status: "signing" } & Review)
  | { status: "signed"; file: AttestedInvoiceFile; fileName: string; supplier: BusinessLookup };

export type PublicBodyEvent =
  | { type: "FILE_READ"; fileName: string; reading: FatturaReading }
  | { type: "EDIT"; field: InvoiceField; value: string }
  | { type: "LOOKUP_STARTED"; vat: string }
  | { type: "LOOKUP_DONE"; vat: string; business: BusinessLookup | undefined }
  | { type: "LOOKUP_FAILED"; vat: string; message: string }
  | { type: "SIGN"; validation: { ok: true } | { ok: false; errors: FieldErrors } }
  | { type: "SIGNED"; file: AttestedInvoiceFile }
  | { type: "SIGN_FAILED"; message: string }
  | { type: "RESET" };

export const EMPTY_FORM: InvoiceForm = { vatNumber: "", number: "", issueDate: "", amount: "", dueDate: "" };
export const initialState: PublicBodyState = { status: "empty" };

// Même règle que le schéma de l'API (`src/api/fund/schemas.ts`), après normalisation.
const VAT_PATTERN = /^[A-Z]{2}[0-9A-Z]{2,20}$/;
const AMOUNT_ERROR = "Enter the total in US dollars, e.g. 10340.00";
const CENTS_PER_USD = 100n;
const FILE_NAME_UNSAFE = /[^A-Za-z0-9._-]+/g;

const normalizeVat = (text: string) => text.replace(/\s+/g, "").toUpperCase();

function dollars(cents: bigint): string {
  return `${cents / CENTS_PER_USD}.${(cents % CENTS_PER_USD).toString().padStart(2, "0")}`;
}

function formFromReading(reading: Exclude<FatturaReading, { reason: "currency" }>): { source: InvoiceSource; form: InvoiceForm; description: string } {
  if (!reading.ok && reading.reason === "not-fatturapa") return { source: "other", form: EMPTY_FORM, description: "" };
  const invoice = reading.ok ? reading.invoice : reading.found;
  return {
    source: reading.ok ? "fatturapa" : "partial",
    form: {
      vatNumber: invoice.vatNumber ?? "",
      number: invoice.number ?? "",
      issueDate: invoice.issueDate ?? "",
      amount: invoice.amountCents === undefined ? "" : dollars(invoice.amountCents),
      dueDate: invoice.dueDate ?? "",
    },
    description: invoice.description ?? "",
  };
}

export function validateForm(form: InvoiceForm, description: string): FormValidation {
  const vatNumber = normalizeVat(form.vatNumber);
  const number = form.number.trim();
  const amountCents = decimalToCents(form.amount.trim().replace(",", "."));
  const errors: FieldErrors = {
    ...(VAT_PATTERN.test(vatNumber) ? {} : { vatNumber: "Enter the supplier's VAT number with its country code, e.g. IT01234567890" }),
    ...(number === "" ? { number: "Enter the invoice number" } : {}),
    ...(isIsoDate(form.issueDate) ? {} : { issueDate: "Enter the issue date" }),
    ...(amountCents !== undefined && amountCents > 0n ? {} : { amount: AMOUNT_ERROR }),
    ...(!isIsoDate(form.dueDate)
      ? { dueDate: "Enter the due date" }
      : isIsoDate(form.issueDate) && form.dueDate <= form.issueDate
        ? { dueDate: "The due date must come after the issue date" }
        : {}),
  };
  if (Object.keys(errors).length > 0 || amountCents === undefined) return { ok: false, errors };
  return {
    ok: true,
    draft: {
      vatNumber,
      number,
      issueDate: form.issueDate,
      amountCents,
      dueDate: form.dueDate,
      description: description.trim() === "" ? `Invoice ${number}` : description.trim(),
    },
  };
}

/** N° de TVA à rechercher : valide, et pas encore recherché pour la facture affichée. */
export function pendingSupplierVat(state: PublicBodyState): string | undefined {
  if (state.status !== "review" || state.supplier.status !== "none") return undefined;
  const vat = normalizeVat(state.form.vatNumber);
  return VAT_PATTERN.test(vat) ? vat : undefined;
}

/** Les champs restent en lecture seule tant que la FatturaPA est complète et valide. */
export function isEditable(state: Review): boolean {
  return state.source !== "fatturapa" || Object.keys(state.errors).length > 0;
}

/** Raison affichée sous « Confirm and sign » désactivé ; undefined si la signature est possible. */
export function signBlocker(state: PublicBodyState): string | undefined {
  if (state.status === "signing") return "Signing in your browser…";
  if (state.status !== "review") return undefined;
  switch (state.supplier.status) {
    case "none":
      // Un n° valide attend la fin de la saisie avant sa recherche.
      return pendingSupplierVat(state) === undefined ? "Enter the supplier's VAT number" : "Looking up the supplier…";
    case "looking":
      return "Looking up the supplier…";
    case "unknown":
      return "The supplier needs a Bari account first";
    case "failed":
      return "The supplier could not be looked up";
    case "found":
      return undefined;
  }
}

/** Nom du fichier signé : le numéro de la facture, sans caractère interdit dans un nom de fichier. */
export function downloadName(number: string): string {
  return `${number.trim().replace(FILE_NAME_UNSAFE, "-")}${ATTESTED_INVOICE_EXTENSION}`;
}

function lookupResult(state: PublicBodyState, vat: string, supplier: SupplierState): PublicBodyState {
  return state.status === "review" && state.supplier.status === "looking" && state.supplier.vat === vat
    ? { ...state, supplier }
    : state;
}

function withoutSignError(state: ReviewState): Omit<ReviewState, "signError"> {
  const { signError: _signError, ...rest } = state;
  return rest;
}

export function publicBodyTransition(state: PublicBodyState, event: PublicBodyEvent): PublicBodyState {
  switch (event.type) {
    case "FILE_READ":
      if (state.status === "signing") return state;
      if (!event.reading.ok && event.reading.reason === "currency") return { status: "empty", refusal: currencyRefusal(event.reading.currency) };
      return { status: "review", fileName: event.fileName, ...formFromReading(event.reading), errors: {}, supplier: { status: "none" } };
    case "EDIT": {
      if (state.status !== "review") return state;
      const { [event.field]: _cleared, ...errors } = state.errors;
      return {
        ...withoutSignError(state),
        form: { ...state.form, [event.field]: event.value },
        errors,
        supplier: event.field === "vatNumber" ? { status: "none" } : state.supplier,
      };
    }
    case "LOOKUP_STARTED":
      return state.status === "review" && pendingSupplierVat(state) === event.vat
        ? { ...state, supplier: { status: "looking", vat: event.vat } }
        : state;
    case "LOOKUP_DONE":
      return lookupResult(
        state,
        event.vat,
        event.business === undefined
          ? { status: "unknown", vat: event.vat }
          : { status: "found", vat: event.vat, business: event.business },
      );
    case "LOOKUP_FAILED":
      return lookupResult(state, event.vat, { status: "failed", vat: event.vat, message: event.message });
    case "SIGN":
      if (state.status !== "review") return state;
      if (!event.validation.ok) return { ...state, errors: event.validation.errors };
      if (state.supplier.status !== "found") return state;
      return { ...withoutSignError(state), status: "signing", errors: {} };
    case "SIGNED":
      if (state.status !== "signing" || state.supplier.status !== "found") return state;
      return { status: "signed", file: event.file, fileName: downloadName(event.file.invoice.number), supplier: state.supplier.business };
    case "SIGN_FAILED":
      return state.status === "signing" ? { ...state, status: "review", signError: event.message } : state;
    case "RESET":
      return initialState;
  }
}
