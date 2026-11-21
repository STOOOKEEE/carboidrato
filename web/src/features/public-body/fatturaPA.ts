// Lecture d'une FatturaPA (XML du SdI) dans le navigateur : les champs que l'organisme public atteste.

import { childElement, childElements, parseXml, XmlSyntaxError, type XmlElement } from "./xml";

export type FatturaField = "vatNumber" | "number" | "issueDate" | "amount" | "dueDate";

export interface FatturaInvoice {
  /** TVA du fournisseur : IdPaese + IdCodice. */
  vatNumber: string;
  number: string;
  /** Dates au format AAAA-MM-JJ, comme dans la FatturaPA. */
  issueDate: string;
  amountCents: bigint;
  dueDate: string;
  /** Motif (Causale) ou première ligne : affiché dans le fichier signé. */
  description?: string;
}

export type FatturaReading =
  | { ok: true; invoice: FatturaInvoice }
  | { ok: false; reason: "not-fatturapa" }
  | { ok: false; reason: "currency"; currency: string | undefined }
  | { ok: false; reason: "missing"; missing: FatturaField[]; found: Partial<FatturaInvoice> };

const ROOT = "FatturaElettronica";
const FINANCED_CURRENCY = "USD";
const DECIMAL_AMOUNT = /^(\d+)(?:\.(\d{1,2}))?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Montant décimal (point, deux décimales au plus) en centimes, sans passer par un flottant. */
export function decimalToCents(text: string): bigint | undefined {
  const match = DECIMAL_AMOUNT.exec(text);
  if (match === null) return undefined;
  const [, dollars, cents = ""] = match;
  return BigInt(dollars) * 100n + BigInt(cents.padEnd(2, "0"));
}

/** Refus d'une facture hors dollars US, devise lue comprise. */
export function currencyRefusal(currency: string | undefined): string {
  const read = currency === undefined ? "This invoice has no currency." : `This invoice is in ${currency}.`;
  return `${read} Atlas finances invoices in US dollars (${FINANCED_CURRENCY}) only.`;
}

export function isIsoDate(text: string): boolean {
  return ISO_DATE.test(text) && !Number.isNaN(Date.parse(text)) && new Date(text).toISOString().startsWith(text);
}

function path(from: XmlElement | undefined, ...names: string[]): XmlElement | undefined {
  return names.reduce<XmlElement | undefined>((element, name) => (element === undefined ? undefined : childElement(element, name)), from);
}

function textAt(from: XmlElement | undefined, ...names: string[]): string | undefined {
  const text = path(from, ...names)?.text.trim();
  return text === undefined || text === "" ? undefined : text;
}

export function readFatturaPA(source: string): FatturaReading {
  let root: XmlElement;
  try {
    root = parseXml(source);
  } catch (error) {
    if (error instanceof XmlSyntaxError) return { ok: false, reason: "not-fatturapa" };
    throw error;
  }
  if (root.name !== ROOT) return { ok: false, reason: "not-fatturapa" };

  const vat = path(root, "FatturaElettronicaHeader", "CedentePrestatore", "DatiAnagrafici", "IdFiscaleIVA");
  const country = textAt(vat, "IdPaese");
  const code = textAt(vat, "IdCodice");
  // Un lot peut compter plusieurs corps : on atteste le premier, celui que le SdI numérote.
  const body = childElement(root, "FatturaElettronicaBody");
  const document = path(body, "DatiGenerali", "DatiGeneraliDocumento");
  const currency = textAt(document, "Divisa");
  if (currency?.toUpperCase() !== FINANCED_CURRENCY) return { ok: false, reason: "currency", currency };
  const issueDate = textAt(document, "Data");
  const total = textAt(document, "ImportoTotaleDocumento");
  const amountCents = total === undefined ? undefined : decimalToCents(total);
  const description = textAt(document, "Causale") ?? textAt(body, "DatiBeniServizi", "DettaglioLinee", "Descrizione");
  const fields = {
    vatNumber: country === undefined || code === undefined ? undefined : `${country.toUpperCase()}${code}`,
    number: textAt(document, "Numero"),
    issueDate: issueDate !== undefined && isIsoDate(issueDate) ? issueDate : undefined,
    amount: amountCents !== undefined && amountCents > 0n ? amountCents : undefined,
    // Paiement en plusieurs fois : la facture n'est soldée qu'à la dernière échéance.
    dueDate: (body === undefined ? [] : childElements(body, "DatiPagamento"))
      .flatMap((payment) => childElements(payment, "DettaglioPagamento"))
      .map((detail) => textAt(detail, "DataScadenzaPagamento"))
      .filter((date): date is string => date !== undefined && isIsoDate(date))
      .sort()
      .at(-1),
  } satisfies Record<FatturaField, unknown>;

  const { amount, ...rest } = fields;
  const read = { ...rest, amountCents: amount, description };
  const found = Object.fromEntries(Object.entries(read).filter(([, value]) => value !== undefined)) as Partial<FatturaInvoice>;
  const missing = (Object.keys(fields) as FatturaField[]).filter((field) => fields[field] === undefined);
  return missing.length === 0 ? { ok: true, invoice: found as FatturaInvoice } : { ok: false, reason: "missing", missing, found };
}
