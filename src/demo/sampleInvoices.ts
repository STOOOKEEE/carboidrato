// FatturaPA d'exemple (FPA12) du pitch dans web/public/samples : le fournisseur de la Comune di Bari lui facture
// FT-2026-0815 à -0817, émises le jour de la génération. Le générateur sert aussi aux e2e (numéros et TVA uniques).

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEMO_DEBTOR } from "../invoice/debtors.js";
import { log } from "../lib/logger.js";

const OUTPUT_DIR = new URL("../../web/public/samples/", import.meta.url);
const MS_PER_DAY = 86_400_000;
/** TVA ordinaire italienne (22 %), en scission des paiements pour une administration (EsigibilitaIVA « S »). */
const VAT_RATE_PERCENT = 22n;
const CENTS_PER_EUR = 100n;

export interface FatturaAddress {
  street: string;
  number: string;
  postcode: string;
  city: string;
  province: string;
}

export interface FatturaSupplier {
  name: string;
  /** « IT » + 11 chiffres. */
  vatNumber: string;
  address: FatturaAddress;
}

export interface FatturaCustomer {
  name: string;
  /** Codice fiscale de l'administration. */
  fiscalCode: string;
  /** Code de l'office destinataire (6 caractères) dans l'IPA. */
  officeCode: string;
  address: FatturaAddress;
}

export interface FatturaSpec {
  supplier: FatturaSupplier;
  customer: FatturaCustomer;
  number: string;
  issueDate: Date;
  dueDate: Date;
  /** Total TTC. */
  totalCents: bigint;
  description: string;
}

/** Chiffre de contrôle d'une partita IVA : somme de Luhn des 10 premiers chiffres. */
export function italianVatCheckDigit(firstTenDigits: string): number {
  const sum = [...firstTenDigits].reduce((total, char, index) => {
    const doubled = Number(char) * (index % 2 === 0 ? 1 : 2);
    return total + (doubled > 9 ? doubled - 9 : doubled);
  }, 0);
  return (10 - (sum % 10)) % 10;
}

/** Matricule fictif, bureau des impôts de Bari (072). */
const PITCH_SUPPLIER_VAT_BODY = "0754321072";

/** Fournisseur de la Comune di Bari du pitch, repris par le script du compte entreprise du pitch. */
export const PITCH_SUPPLIER: FatturaSupplier = {
  name: "Asfalti Sparano S.r.l.",
  vatNumber: `IT${PITCH_SUPPLIER_VAT_BODY}${italianVatCheckDigit(PITCH_SUPPLIER_VAT_BODY)}`,
  address: { street: "Via Sparano da Bari", number: "112", postcode: "70121", city: "Bari", province: "BA" },
};

/** Codes d'office (CodiceDestinatario) illustratifs : Bari ne lit que le fournisseur, le numéro, le montant et les dates. */
export const COMUNE_DI_BARI: FatturaCustomer = {
  name: DEMO_DEBTOR.name,
  fiscalCode: "80015010723",
  officeCode: "UFB7Q2",
  address: { street: "Corso Vittorio Emanuele II", number: "84", postcode: "70122", city: "Bari", province: "BA" },
};

export const REGIONE_PUGLIA: FatturaCustomer = {
  name: "Regione Puglia",
  fiscalCode: "80017210727",
  officeCode: "UF3KLM",
  address: { street: "Via Gentile", number: "52", postcode: "70126", city: "Bari", province: "BA" },
};

/** Factures du pitch : jamais financées par un test ; une par palier de l'offre (10 000, 20 000 et 5 000 €). */
export const PITCH_INVOICES = [
  { number: "FT-2026-0815", totalCents: 1_034_000n, termDays: 90, description: "Rifacimento manto stradale, via Sparano (lotto 2)" },
  { number: "FT-2026-0816", totalCents: 2_379_000n, termDays: 60, description: "Manutenzione illuminazione pubblica, quartiere Murat" },
  { number: "FT-2026-0817", totalCents: 683_240n, termDays: 120, description: "Ripristino segnaletica orizzontale, lungomare Nazario Sauro" },
] as const;

const XML_ESCAPES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
const escapeXml = (text: string) => text.replace(/[&<>"']/g, (char) => XML_ESCAPES[char]);
const euros = (cents: bigint) => `${cents / CENTS_PER_EUR}.${(cents % CENTS_PER_EUR).toString().padStart(2, "0")}`;
const isoDate = (date: Date) => date.toISOString().slice(0, 10);

function sede({ street, number, postcode, city, province }: FatturaAddress): string {
  return `<Sede>
        <Indirizzo>${escapeXml(street)}</Indirizzo>
        <NumeroCivico>${escapeXml(number)}</NumeroCivico>
        <CAP>${postcode}</CAP>
        <Comune>${escapeXml(city)}</Comune>
        <Provincia>${province}</Provincia>
        <Nazione>IT</Nazione>
      </Sede>`;
}

/** FatturaPA 1.2 (FPA12) d'une seule ligne au taux de 22 %, payable par virement (MP05) à l'échéance. */
export function fatturaPaXml({ supplier, customer, number, issueDate, dueDate, totalCents, description }: FatturaSpec): string {
  const taxable = (totalCents * CENTS_PER_EUR + (CENTS_PER_EUR + VAT_RATE_PERCENT) / 2n) / (CENTS_PER_EUR + VAT_RATE_PERCENT);
  const tax = totalCents - taxable;
  const country = supplier.vatNumber.slice(0, 2);
  const code = supplier.vatNumber.slice(2);
  return `<?xml version="1.0" encoding="UTF-8"?>
<p:FatturaElettronica versione="FPA12" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2 http://www.fatturapa.gov.it/export/fatturazione/sdi/fatturapa/v1.2/Schema_del_file_xml_FatturaPA_versione_1.2.xsd">
  <FatturaElettronicaHeader>
    <DatiTrasmissione>
      <IdTrasmittente>
        <IdPaese>${country}</IdPaese>
        <IdCodice>${code}</IdCodice>
      </IdTrasmittente>
      <ProgressivoInvio>${number.replace(/[^0-9A-Za-z]/g, "").slice(-10)}</ProgressivoInvio>
      <FormatoTrasmissione>FPA12</FormatoTrasmissione>
      <CodiceDestinatario>${customer.officeCode}</CodiceDestinatario>
    </DatiTrasmissione>
    <CedentePrestatore>
      <DatiAnagrafici>
        <IdFiscaleIVA>
          <IdPaese>${country}</IdPaese>
          <IdCodice>${code}</IdCodice>
        </IdFiscaleIVA>
        <Anagrafica>
          <Denominazione>${escapeXml(supplier.name)}</Denominazione>
        </Anagrafica>
        <RegimeFiscale>RF01</RegimeFiscale>
      </DatiAnagrafici>
      ${sede(supplier.address)}
    </CedentePrestatore>
    <CessionarioCommittente>
      <DatiAnagrafici>
        <CodiceFiscale>${customer.fiscalCode}</CodiceFiscale>
        <Anagrafica>
          <Denominazione>${escapeXml(customer.name)}</Denominazione>
        </Anagrafica>
      </DatiAnagrafici>
      ${sede(customer.address)}
    </CessionarioCommittente>
  </FatturaElettronicaHeader>
  <FatturaElettronicaBody>
    <DatiGenerali>
      <DatiGeneraliDocumento>
        <TipoDocumento>TD01</TipoDocumento>
        <Divisa>EUR</Divisa>
        <Data>${isoDate(issueDate)}</Data>
        <Numero>${escapeXml(number)}</Numero>
        <ImportoTotaleDocumento>${euros(totalCents)}</ImportoTotaleDocumento>
        <Causale>${escapeXml(description)}</Causale>
      </DatiGeneraliDocumento>
    </DatiGenerali>
    <DatiBeniServizi>
      <DettaglioLinee>
        <NumeroLinea>1</NumeroLinea>
        <Descrizione>${escapeXml(description)}</Descrizione>
        <Quantita>1.00</Quantita>
        <PrezzoUnitario>${euros(taxable)}</PrezzoUnitario>
        <PrezzoTotale>${euros(taxable)}</PrezzoTotale>
        <AliquotaIVA>${VAT_RATE_PERCENT}.00</AliquotaIVA>
      </DettaglioLinee>
      <DatiRiepilogo>
        <AliquotaIVA>${VAT_RATE_PERCENT}.00</AliquotaIVA>
        <ImponibileImporto>${euros(taxable)}</ImponibileImporto>
        <Imposta>${euros(tax)}</Imposta>
        <EsigibilitaIVA>S</EsigibilitaIVA>
      </DatiRiepilogo>
    </DatiBeniServizi>
    <DatiPagamento>
      <CondizioniPagamento>TP02</CondizioniPagamento>
      <DettaglioPagamento>
        <ModalitaPagamento>MP05</ModalitaPagamento>
        <DataScadenzaPagamento>${isoDate(dueDate)}</DataScadenzaPagamento>
        <ImportoPagamento>${euros(taxable)}</ImportoPagamento>
      </DettaglioPagamento>
    </DatiPagamento>
  </FatturaElettronicaBody>
</p:FatturaElettronica>
`;
}

function main(): void {
  const issueDate = new Date(`${isoDate(new Date())}T00:00:00Z`);
  mkdirSync(OUTPUT_DIR, { recursive: true });
  for (const invoice of PITCH_INVOICES) {
    const target = new URL(`${invoice.number}.xml`, OUTPUT_DIR);
    const xml = fatturaPaXml({
      supplier: PITCH_SUPPLIER,
      customer: COMUNE_DI_BARI,
      number: invoice.number,
      issueDate,
      dueDate: new Date(issueDate.getTime() + invoice.termDays * MS_PER_DAY),
      totalCents: invoice.totalCents,
      description: invoice.description,
    });
    writeFileSync(target, xml);
    log.info(`écrit ${fileURLToPath(target)}`);
  }
}

// Importé par les e2e pour le seul générateur : n'écrit les fichiers que lancé par `npm run samples`.
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
