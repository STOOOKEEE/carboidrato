// Lecture d'une FatturaPA dans le navigateur : exemples générés par `npm run samples`, champs manquants, autre fichier.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { currencyRefusal, decimalToCents, isIsoDate, readFatturaPA, type FatturaInvoice } from "./fatturaPA";

const MS_PER_DAY = 86_400_000;

function readSample(number: string): FatturaInvoice {
  const reading = readFatturaPA(readFileSync(new URL(`../../../public/samples/${number}.xml`, import.meta.url), "utf8"));
  if (!reading.ok) assert.fail(`${number}: ${reading.reason}`);
  return reading.invoice;
}

/** Chiffre de contrôle d'une partita IVA (11 chiffres) : somme de Luhn sur les 10 premiers. */
function hasValidItalianChecksum(digits: string): boolean {
  const sum = [...digits.slice(0, 10)].reduce((total, char, index) => {
    const digit = Number(char);
    if (index % 2 === 0) return total + digit;
    const doubled = digit * 2;
    return total + (doubled > 9 ? doubled - 9 : doubled);
  }, 0);
  return (10 - (sum % 10)) % 10 === Number(digits[10]);
}

/** FatturaPA minimale, préfixe d'espace de noms au choix, champs retirables un à un. */
function fattura(options: { prefix?: string; omit?: string[]; total?: string; currency?: string } = {}): string {
  const { prefix = "p", omit = [], total = "10340.00", currency = "USD" } = options;
  const tag = (name: string, content: string) => (omit.includes(name) ? "" : `<${name}>${content}</${name}>`);
  const root = prefix === "" ? "FatturaElettronica" : `${prefix}:FatturaElettronica`;
  const ns = prefix === "" ? "xmlns" : `xmlns:${prefix}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<${root} versione="FPA12" ${ns}="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2">
  <FatturaElettronicaHeader>
    <CedentePrestatore><DatiAnagrafici>
      <IdFiscaleIVA>${tag("IdPaese", "IT")}${tag("IdCodice", "07543210725")}</IdFiscaleIVA>
      <Anagrafica><Denominazione>Fornitore S.r.l.</Denominazione></Anagrafica>
    </DatiAnagrafici></CedentePrestatore>
  </FatturaElettronicaHeader>
  <FatturaElettronicaBody>
    <DatiGenerali><DatiGeneraliDocumento>
      <TipoDocumento>TD01</TipoDocumento>${tag("Divisa", currency)}${tag("Data", "2026-11-20")}${tag("Numero", "FT-2026-0901")}
      ${tag("ImportoTotaleDocumento", total)}${tag("Causale", "Manutenzione strade")}
    </DatiGeneraliDocumento></DatiGenerali>
    <DatiBeniServizi><DettaglioLinee><Descrizione>Asfalto</Descrizione></DettaglioLinee></DatiBeniServizi>
    <DatiPagamento>
      <DettaglioPagamento>${tag("DataScadenzaPagamento", "2027-01-18")}</DettaglioPagamento>
      <DettaglioPagamento>${tag("DataScadenzaPagamento", "2027-02-18")}</DettaglioPagamento>
    </DatiPagamento>
  </FatturaElettronicaBody>
</${root}>`;
}

describe("FatturaPA d'exemple (npm run samples)", () => {
  test("FT-2026-0815 : 10 340,00 $ à Comune di Bari, échéance à 90 jours", () => {
    const invoice = readSample("FT-2026-0815");
    assert.equal(invoice.number, "FT-2026-0815");
    assert.equal(invoice.amountCents, 1_034_000n);
    assert.ok(isIsoDate(invoice.issueDate));
    assert.equal((Date.parse(invoice.dueDate) - Date.parse(invoice.issueDate)) / MS_PER_DAY, 90);
  });

  test("FT-2026-0816 et FT-2026-0817 tombent dans d'autres paliers de l'offre", () => {
    const tiers = ["FT-2026-0815", "FT-2026-0816", "FT-2026-0817"].map((number) => {
      const { amountCents } = readSample(number);
      return [5_000_00n, 10_000_00n, 20_000_00n, 50_000_00n, 100_000_00n].filter((tier) => tier <= amountCents).length;
    });
    assert.equal(new Set(tiers).size, 3);
    assert.ok(tiers.every((tier) => tier > 0));
  });

  test("les trois factures viennent du même fournisseur, n° de TVA italien valide", () => {
    const vats = new Set(["FT-2026-0815", "FT-2026-0816", "FT-2026-0817"].map((number) => readSample(number).vatNumber));
    assert.equal(vats.size, 1);
    const [vat] = [...vats];
    assert.match(vat, /^IT\d{11}$/);
    assert.ok(hasValidItalianChecksum(vat.slice(2)), vat);
  });
});

describe("lecture d'une FatturaPA", () => {
  test("lit TVA, numéro, dates, montant exact et motif, quel que soit le préfixe", () => {
    for (const prefix of ["p", "ns2", ""]) {
      const reading = readFatturaPA(fattura({ prefix }));
      assert.deepEqual(reading, {
        ok: true,
        invoice: {
          vatNumber: "IT07543210725",
          number: "FT-2026-0901",
          issueDate: "2026-11-20",
          amountCents: 1_034_000n,
          dueDate: "2027-02-18",
          description: "Manutenzione strade",
        },
      });
    }
  });

  test("sans motif, la description est celle de la première ligne", () => {
    const reading = readFatturaPA(fattura({ omit: ["Causale"] }));
    assert.ok(reading.ok);
    assert.equal(reading.invoice.description, "Asfalto");
  });

  test("l'échéance est la dernière des échéances de paiement", () => {
    const reading = readFatturaPA(fattura());
    assert.ok(reading.ok);
    assert.equal(reading.invoice.dueDate, "2027-02-18");
  });

  test("liste les champs manquants et garde ceux qui ont été lus", () => {
    const reading = readFatturaPA(fattura({ omit: ["ImportoTotaleDocumento", "DataScadenzaPagamento", "IdCodice"] }));
    assert.deepEqual(reading, {
      ok: false,
      reason: "missing",
      missing: ["vatNumber", "amount", "dueDate"],
      found: { number: "FT-2026-0901", issueDate: "2026-11-20", description: "Manutenzione strade" },
    });
  });

  test("un montant illisible ou nul compte comme manquant", () => {
    for (const total of ["10.340,00", "-10.00", "0.00", "12.345"]) {
      const reading = readFatturaPA(fattura({ total }));
      assert.ok(!reading.ok && reading.reason === "missing", total);
      assert.deepEqual(reading.missing, ["amount"]);
    }
  });

  test("une facture en dollars US est acceptée", () => {
    assert.equal(readFatturaPA(fattura({ currency: "USD" })).ok, true);
  });

  test("une facture dans une autre devise est refusée, avec sa devise", () => {
    for (const currency of ["GBP", "JPY"]) {
      assert.deepEqual(readFatturaPA(fattura({ currency })), { ok: false, reason: "currency", currency });
    }
  });

  test("une facture sans devise est refusée", () => {
    assert.deepEqual(readFatturaPA(fattura({ omit: ["Divisa"] })), { ok: false, reason: "currency", currency: undefined });
  });

  test("le refus nomme la devise lue et la seule devise financée", () => {
    assert.equal(currencyRefusal("GBP"), "This invoice is in GBP. Atlas finances invoices in US dollars (USD) only.");
    assert.equal(currencyRefusal(undefined), "This invoice has no currency. Atlas finances invoices in US dollars (USD) only.");
  });

  test("un autre fichier n'est pas une FatturaPA", () => {
    for (const source of ["%PDF-1.7 binary", '{"format":"bari.attested-invoice.v1"}', "<Invoice><ID>1</ID></Invoice>"]) {
      assert.deepEqual(readFatturaPA(source), { ok: false, reason: "not-fatturapa" });
    }
  });
});

describe("montants et dates", () => {
  test("convertit un montant décimal en centimes, exactement", () => {
    assert.equal(decimalToCents("10340.00"), 1_034_000n);
    assert.equal(decimalToCents("10340.5"), 1_034_050n);
    assert.equal(decimalToCents("10340"), 1_034_000n);
    assert.equal(decimalToCents("0.29"), 29n);
    assert.equal(decimalToCents("99999999999.99"), 9_999_999_999_999n);
    for (const text of ["", "1.234", "1,00", "-5", "1e3", " 12"]) assert.equal(decimalToCents(text), undefined, text);
  });

  test("n'accepte que des dates du calendrier au format AAAA-MM-JJ", () => {
    assert.ok(isIsoDate("2026-11-20"));
    assert.ok(isIsoDate("2028-02-29"));
    for (const text of ["2026-02-30", "2026-13-01", "20-11-2026", "2026-11-20T00:00:00Z", ""]) {
      assert.ok(!isIsoDate(text), text);
    }
  });
});
