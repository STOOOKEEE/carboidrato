// Parité de la signature du navigateur avec celle du back (fixture écrit et vérifié par `npm run fixtures`).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import type { AttestedInvoiceFile, PublicBodyKeys } from "../../../../src/api/contract";
import { attestInvoice, canonicalInvoiceNumber, type AttestRequest } from "./attest";

interface AttestationFixture {
  keys: PublicBodyKeys;
  supplierAccount: string;
  invoice: { number: string; issueDate: string; amountCents: string; dueDate: string; description: string };
  networkId: number;
  registry: string;
  file: AttestedInvoiceFile;
}

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/attestation.json", import.meta.url), "utf8"),
) as AttestationFixture;

const { keys } = fixture;

const request = (number = fixture.invoice.number): AttestRequest => ({
  keys,
  supplierAccount: fixture.supplierAccount,
  invoice: { ...fixture.invoice, number, amountCents: BigInt(fixture.invoice.amountCents) },
  networkId: fixture.networkId,
  registry: fixture.registry,
});

describe("attestation signée dans le navigateur", () => {
  test("le fichier est identique à celui que signe le back", async () => {
    assert.deepEqual(await attestInvoice(request()), fixture.file);
  });

  test("le numéro est mis sous forme canonique avant le HMAC : la même facture donne le même uuid", async () => {
    const canonical = canonicalInvoiceNumber(fixture.invoice.number);
    assert.notEqual(canonical, fixture.invoice.number);
    const file = await attestInvoice(request(canonical));
    assert.equal(file.attestation.uuid, fixture.file.attestation.uuid);
    assert.equal(file.invoice.number, canonical);
  });

  test("forme canonique : sans espaces, en majuscules", () => {
    assert.equal(canonicalInvoiceNumber("  ft 2026 / 0815\t"), "FT2026/0815");
  });
});
