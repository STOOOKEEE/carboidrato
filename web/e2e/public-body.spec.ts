// Organisme public : FatturaPA lue et signée dans le navigateur, fournisseur retrouvé par son seul n° de TVA.

import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { ATTESTED_INVOICE_FORMAT, type AttestedInvoiceFile, type SignupResponse } from "../../src/api/contract";
import { fatturaPaXml, PITCH_SUPPLIER, REGIONE_PUGLIA } from "../../src/demo/sampleInvoices";
import { signedInvoiceText } from "../src/signedInvoicePdf";
import { capture } from "./capture";
import { signInPublicBody } from "./publicBodySession";

const HTTP_CREATED = 201;
const MS_PER_DAY = 86_400_000;
const TERM_DAYS = 90;
const TOTAL_CENTS = 1_034_000n;
/** Le montant, sous toutes ses formes, ne doit apparaître dans aucune requête de la page. */
const AMOUNT_FORMS = ["10340", "1034000"];
/** Ouverture du compte géré du fournisseur : plusieurs transactions validées. */
const SIGNUP_TIMEOUT_MS = 120_000;

/** Chiffres uniques, sans le début du montant : la recherche par TVA ne doit pas le faire apparaître par hasard. */
function uniqueDigits(length: number): string {
  for (;;) {
    const digits = `${Date.now()}${Math.floor(Math.random() * 1e6)}`.slice(-length);
    if (!digits.includes("1034")) return digits;
  }
}

test("a public body reads a FatturaPA, finds the supplier and signs it in the browser", async ({ page, request }) => {
  test.setTimeout(SIGNUP_TIMEOUT_MS + 60_000);
  const id = uniqueDigits(11);
  const company = `E2E Forniture ${id} S.r.l.`;
  const vatNumber = `IT${id}`;
  const signup = await request.post("/api/auth/signup", {
    data: { email: `ops-${id}@e2e.example`, password: "correct horse battery", role: "business", profile: { company, vatNumber } },
    timeout: SIGNUP_TIMEOUT_MS,
  });
  expect(signup.status(), await signup.text()).toBe(HTTP_CREATED);
  const supplierAccount = ((await signup.json()) as SignupResponse).user.address;

  await signInPublicBody(page);
  const number = `FT-E2E-${Date.now().toString(36).toUpperCase()}`;
  const issueDate = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const xml = fatturaPaXml({
    supplier: { ...PITCH_SUPPLIER, name: company, vatNumber },
    customer: REGIONE_PUGLIA,
    number,
    issueDate,
    dueDate: new Date(issueDate.getTime() + TERM_DAYS * MS_PER_DAY),
    totalCents: TOTAL_CENTS,
    description: "Manutenzione impianti, sede di via Gentile",
  });

  const sent: string[] = [];
  page.on("request", (outgoing) => sent.push(`${outgoing.url()} ${outgoing.postData() ?? ""}`));
  await page.goto("/#/public");
  await expect(page.getByText("Signed in your browser. Atlas never receives this invoice.")).toBeVisible();
  await page.getByTestId("drop-input").setInputFiles({ name: `${number}.xml`, mimeType: "application/xml", buffer: Buffer.from(xml) });

  await expect(page.getByText(company, { exact: true })).toBeVisible();
  await expect(page.getByText(number, { exact: true })).toBeVisible();
  await expect(page.getByText("$10,340.00", { exact: true })).toBeVisible();
  await expect(page.getByText(vatNumber, { exact: true })).toBeVisible();
  await capture(page, "public-body");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Confirm and sign" }).click();
  await expect(page.getByRole("heading", { name: "Signed. Send this PDF to your supplier" })).toBeVisible();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe(`${number}.signed.pdf`);
  const file = JSON.parse((await signedInvoiceText(await readFile(await saved.path()))) ?? "") as AttestedInvoiceFile;
  expect(file.format).toBe(ATTESTED_INVOICE_FORMAT);
  expect(file.invoice.number).toBe(number);
  expect(file.invoice.debtorName).toBe("Regione Puglia");
  expect(file.attestation.account).toBe(supplierAccount);
  expect(file.attestation.amountCents).toBe(TOTAL_CENTS.toString());
  await capture(page, "public-body-signed");

  expect(sent.some((entry) => entry.includes(`/api/businesses/by-vat/${vatNumber}`))).toBe(true);
  for (const entry of sent) {
    for (const secret of [...AMOUNT_FORMS, number]) expect(entry, entry).not.toContain(secret);
  }
});
