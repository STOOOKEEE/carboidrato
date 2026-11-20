// Tests de l'entrée de la preuve : le seuil public vient de l'avance, le montant exact reste dans le témoin.

import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { Wallet } from "xrpl";
import { FUND_VINTAGE } from "../../config/cohort.js";
import { verifiedDebtorList } from "../../invoice/certificate.js";
import { VERIFIED_DEBTORS } from "../../invoice/debtors.js";
import { attestInvoice, deriveDebtor, releaseZkResources } from "../../zk/index.js";
import { toAttestedInvoiceFile } from "../attestedInvoice.js";
import { buildProveInput, toCircuitInput } from "./zkInputs.js";

const NETWORK_ID = 1000;
const DUE_IN_SECONDS = 90n * 86_400n;

after(releaseZkResources);

describe("entrée de la preuve", () => {
  test("une facture de 10 340 € est prouvée au seuil de 10 000 €", async () => {
    const sme = Wallet.generate().address;
    const registry = Wallet.generate().address;
    const debtorName = VERIFIED_DEBTORS[0].name;
    const attestation = await attestInvoice(await deriveDebtor(debtorName), {
      account: sme,
      amount: 1_034_000n,
      dueDate: BigInt(Math.floor(Date.now() / 1_000)) + DUE_IN_SECONDS,
      invoiceNumber: "FT-2026-0815",
      networkId: NETWORK_ID,
      registry,
    });
    const file = toAttestedInvoiceFile(
      { number: "FT-2026-0815", debtorName, description: "Road resurfacing", issueDate: new Date() },
      attestation,
    );

    const input = await buildProveInput(file, {
      smeAccount: sme,
      registry,
      networkId: NETWORK_ID,
      debtorsRoot: (await verifiedDebtorList()).root,
      vintage: BigInt(FUND_VINTAGE),
    });
    const circuit = toCircuitInput(input);

    assert.equal(circuit.threshold, "1000000");
    assert.equal(circuit.amount, "1034000");
  });
});
