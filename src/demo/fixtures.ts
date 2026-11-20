// Fixture de parité front ↔ back : témoin de la facture de démo calculé par src/, comparé par web/src/features/funding.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { toAttestedInvoiceFile } from "../api/attestedInvoice.js";
import { buildProveInput, debtorPath, publicDebtors, toCircuitInput } from "../api/fund/zkInputs.js";
import { FUND_VINTAGE } from "../config/cohort.js";
import { verifiedDebtorList } from "../invoice/certificate.js";
import { DEMO_DEBTOR } from "../invoice/debtors.js";
import { loanTerms } from "../lending/loanTerms.js";
import { attestInvoice, deriveDebtor, invoiceNullifier, releaseZkResources, toHex32 } from "../zk/index.js";

const FIXTURE_PATH = fileURLToPath(new URL("../../web/src/features/funding/fixtures/witness.json", import.meta.url));

/** Comptes XRPL publics et fixes : seule compte la conversion adresse → entier du corps. */
const SME_ACCOUNT = "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe";
const REGISTRY_ACCOUNT = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const NETWORK_ID = 1000;
const INVOICE_NUMBER = "FT-2026-0815";
const INVOICE_AMOUNT_CENTS = 1_034_000n;
const ISSUE_DATE = new Date("2026-11-20T09:00:00Z");
const DUE_DATE_SECONDS = BigInt(Date.parse("2027-02-18T00:00:00Z") / 1_000);
/** Aléa r fixé (31 octets) pour que le fixture soit reproductible. */
const BLINDING = BigInt(`0x${"5a".repeat(31)}`);

async function main(): Promise<void> {
  const debtors = await publicDebtors();
  const debtorPaths = await Promise.all(
    debtors.map(async ({ name }) => {
      const { root, path } = await debtorPath((await deriveDebtor(name)).publicKey);
      return {
        name,
        root: root.toString(),
        pathElements: path.pathElements.map(String),
        pathIndices: path.pathIndices,
      };
    }),
  );

  const attestation = await attestInvoice(await deriveDebtor(DEMO_DEBTOR.name), {
    account: SME_ACCOUNT,
    amount: INVOICE_AMOUNT_CENTS,
    dueDate: DUE_DATE_SECONDS,
    invoiceNumber: INVOICE_NUMBER,
    networkId: NETWORK_ID,
    registry: REGISTRY_ACCOUNT,
  });
  const file = toAttestedInvoiceFile(
    { number: INVOICE_NUMBER, debtorName: DEMO_DEBTOR.name, description: "Road resurfacing, via Sparano", issueDate: ISSUE_DATE },
    attestation,
  );
  const proveInput = await buildProveInput(file, {
    smeAccount: SME_ACCOUNT,
    registry: REGISTRY_ACCOUNT,
    networkId: NETWORK_ID,
    debtorsRoot: (await verifiedDebtorList()).root,
    vintage: BigInt(FUND_VINTAGE),
  });

  const fixture = {
    debtors,
    debtorPaths,
    file,
    threshold: loanTerms().provenThresholdCents.toString(),
    vintage: FUND_VINTAGE.toString(),
    blinding: BLINDING.toString(),
    circuitInput: toCircuitInput({ ...proveInput, blinding: BLINDING }),
    nullifier: toHex32(await invoiceNullifier(attestation.uuid)),
  };
  writeFileSync(FIXTURE_PATH, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`fixture écrit : ${FIXTURE_PATH}`);
}

try {
  await main();
} finally {
  await releaseZkResources();
}
