// Tests de l'entrée de la preuve : le seuil public est le palier du montant, le montant exact reste dans le témoin.

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { Wallet } from "xrpl";
import { FUND_VINTAGE } from "../../config/cohort.js";
import { verifiedDebtorList } from "../../invoice/certificate.js";
import { VERIFIED_DEBTORS } from "../../invoice/debtors.js";
import { attestInvoice, deriveDebtor, releaseZkResources } from "../../zk/index.js";
import { toAttestedInvoiceFile } from "../attestedInvoice.js";
import type { AttestedInvoiceFile } from "../contract.js";
import { HttpError } from "./errors.js";
import { buildProveInput, toCircuitInput, type ProofExpectations } from "./zkInputs.js";

const NETWORK_ID = 1000;
const DUE_IN_SECONDS = 90n * 86_400n;
const INVOICE_NUMBER = "FT-TEST/ZK-INPUTS";

const sme = Wallet.generate().address;
const registry = Wallet.generate().address;
let expected: ProofExpectations;

async function attested(amountCents: bigint): Promise<AttestedInvoiceFile> {
  const debtorName = VERIFIED_DEBTORS[0].name;
  const attestation = await attestInvoice(await deriveDebtor(debtorName), {
    account: sme,
    amount: amountCents,
    dueDate: BigInt(Math.floor(Date.now() / 1_000)) + DUE_IN_SECONDS,
    invoiceNumber: INVOICE_NUMBER,
    networkId: NETWORK_ID,
    registry,
  });
  return toAttestedInvoiceFile(
    { number: INVOICE_NUMBER, debtorName, description: "Road resurfacing", issueDate: new Date() },
    attestation,
  );
}

before(async () => {
  expected = {
    smeAccount: sme,
    registry,
    networkId: NETWORK_ID,
    debtorsRoot: (await verifiedDebtorList()).root,
    vintage: BigInt(FUND_VINTAGE),
  };
});

after(releaseZkResources);

describe("entrée de la preuve", () => {
  const cases: [string, bigint, string][] = [
    ["10 340 €", 1_034_000n, "1000000"],
    ["23 450 €", 2_345_000n, "2000000"],
    ["100 000 €", 10_000_000n, "10000000"],
    ["250 000 €", 25_000_000n, "10000000"],
  ];
  for (const [label, amountCents, threshold] of cases) {
    test(`une facture de ${label} est prouvée au plus grand palier qui ne la dépasse pas (${threshold} centimes)`, async () => {
      const circuit = toCircuitInput(await buildProveInput(await attested(amountCents), expected));
      assert.equal(circuit.threshold, threshold);
      assert.equal(circuit.amount, amountCents.toString());
    });
  }

  test("une facture de 4 999 €, sous le premier palier, est refusée", async () => {
    await assert.rejects(
      buildProveInput(await attested(499_900n), expected),
      (error) => error instanceof HttpError && /premier palier/.test(error.message),
    );
  });
});
