// PDF de la facture signée : lisible par le fournisseur, avec la facture attestée embarquée que Bari relit dans la page.

import assert from "node:assert/strict";
import { test } from "node:test";
import { PDFDocument } from "pdf-lib";
import type { AttestedInvoiceFile } from "../../src/api/contract";
import { isPdf, signedInvoicePdf, signedInvoiceText } from "./signedInvoicePdf";

const signed: AttestedInvoiceFile = {
  format: "bari.attested-invoice.v1",
  invoice: { number: "FT-2026/0901", debtorName: "Comune di Bari", description: "Manutenzione strade", issueDate: "2026-11-20T00:00:00.000Z" },
  attestation: {
    account: "rhYMHhsasF9gfSYV9nDnkbYCau33rrZdps",
    amountCents: "1034000",
    dueDate: "1802649600",
    networkId: 1000,
    registry: "rhYMHhsasF9gfSYV9nDnkbYCau33rrZdps",
    uuid: "00",
    debtorPublicKey: { ax: "1", ay: "2" },
    signature: { r8x: "3", r8y: "4", s: "5" },
  },
};
const supplier = { company: "TEST-BUSINESS", vatNumber: "IT01234567890" };

test("le PDF signé embarque la facture attestée, relue à l'identique", async () => {
  const pdf = await signedInvoicePdf(signed, supplier);
  assert.equal(isPdf(pdf), true);
  assert.deepEqual(JSON.parse((await signedInvoiceText(pdf)) ?? ""), signed);
});

test("une page lisible, titrée par le numéro de la facture", async () => {
  const document = await PDFDocument.load(await signedInvoicePdf(signed, supplier));
  assert.equal(document.getPageCount(), 1);
  assert.equal(document.getTitle(), "Signed invoice FT-2026/0901");
});

test("un PDF sans signature de Bari ou un PDF illisible ne donnent aucune facture", async () => {
  const plain = await PDFDocument.create();
  plain.addPage();
  assert.equal(await signedInvoiceText(await plain.save()), undefined);
  assert.equal(await signedInvoiceText(new TextEncoder().encode("%PDF-1.7 broken")), undefined);
});

test("un .bari.json reste accepté : son texte est rendu tel quel", async () => {
  const json = new TextEncoder().encode(JSON.stringify(signed));
  assert.equal(isPdf(json), false);
  assert.equal(await signedInvoiceText(json), JSON.stringify(signed));
});
