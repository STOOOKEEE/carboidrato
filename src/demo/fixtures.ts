// Fixtures de parité front ↔ back calculés par src/ : témoin de la preuve (web/src/features/funding) et attestation
// signée par un organisme public (web/src/features/public-body), vérifiée ici avant d'être écrite.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseAttestedInvoice, toAttestedInvoiceFile, toCircuitAttestation } from "../api/attestedInvoice.js";
import type { PublicBodyKeys } from "../api/contract.js";
import { buildProveInput, debtorPath, publicDebtors, toCircuitInput } from "../api/fund/zkInputs.js";
import { FUND_VINTAGE } from "../config/cohort.js";
import { verifiedDebtorList } from "../invoice/certificate.js";
import { DEMO_DEBTOR, VERIFIED_DEBTORS } from "../invoice/debtors.js";
import { normalizeInvoiceNumber } from "../invoice/invoice.js";
import {
  attestInvoice,
  debtorFromKeys,
  deriveDebtor,
  invoiceNullifier,
  releaseZkResources,
  toHex32,
  verifyAttestation,
} from "../zk/index.js";

const WITNESS_FIXTURE_PATH = fileURLToPath(new URL("../../web/src/features/funding/fixtures/witness.json", import.meta.url));
const ATTESTATION_FIXTURE_PATH = fileURLToPath(
  new URL("../../web/src/features/public-body/fixtures/attestation.json", import.meta.url),
);

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
const MS_PER_SECOND = 1_000;
const CENTS_PER_EUR = 100;

/** Facture signée par un organisme autre que la mairie du pitch ; numéro saisi sous une forme non canonique. */
const ATTESTING_BODY = VERIFIED_DEBTORS[2];
/** Clés de test fixes (pas celles de l'organisme), au format hex de `GET /api/public-body/keys`. */
const TEST_EDDSA_PRIVATE_KEY = Buffer.alloc(32, 0x01);
const TEST_HMAC_KEY = Buffer.alloc(32, 0x02);
const ATTESTED_INVOICE = {
  number: "ft 2026-0901",
  issueDate: "2026-11-20",
  amountCents: 2_379_000n,
  dueDate: "2027-01-19",
  description: "Manutenzione strade provinciali",
};

async function witnessFixture(): Promise<void> {
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
    threshold: proveInput.threshold.toString(),
    vintage: FUND_VINTAGE.toString(),
    blinding: BLINDING.toString(),
    circuitInput: toCircuitInput({ ...proveInput, blinding: BLINDING }),
    nullifier: toHex32(await invoiceNullifier(attestation.uuid)),
  };
  writeFileSync(WITNESS_FIXTURE_PATH, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`fixture écrit : ${WITNESS_FIXTURE_PATH}`);
}

/** Clés servies par `GET /api/public-body/keys`, la facture saisie par l'organisme et le fichier signé par src/zk. */
async function attestationFixture(): Promise<void> {
  const body = await debtorFromKeys(ATTESTING_BODY.name, TEST_EDDSA_PRIVATE_KEY, TEST_HMAC_KEY);
  const keys: PublicBodyKeys = {
    name: body.name,
    ipaCode: ATTESTING_BODY.ipaCode,
    eddsaPrivateKey: body.eddsaPrivateKey.toString("hex"),
    hmacKey: body.hmacKey.toString("hex"),
    publicKey: { ax: body.publicKey.ax.toString(), ay: body.publicKey.ay.toString() },
  };
  const issueDate = new Date(`${ATTESTED_INVOICE.issueDate}T00:00:00Z`);
  const dueDate = new Date(`${ATTESTED_INVOICE.dueDate}T00:00:00Z`);
  const invoiceNumber = normalizeInvoiceNumber({
    debtor: ATTESTING_BODY,
    number: ATTESTED_INVOICE.number,
    issueDate,
    dueDate,
    amountEur: Number(ATTESTED_INVOICE.amountCents) / CENTS_PER_EUR,
  });
  const attestation = await attestInvoice(body, {
    account: SME_ACCOUNT,
    amount: ATTESTED_INVOICE.amountCents,
    dueDate: BigInt(dueDate.getTime() / MS_PER_SECOND),
    invoiceNumber,
    networkId: NETWORK_ID,
    registry: REGISTRY_ACCOUNT,
  });
  const file = toAttestedInvoiceFile(
    { number: ATTESTED_INVOICE.number, debtorName: body.name, description: ATTESTED_INVOICE.description, issueDate },
    attestation,
  );
  if (!(await verifyAttestation(toCircuitAttestation(parseAttestedInvoice(file))))) {
    throw new Error("Attestation du fixture refusée par verifyAttestation");
  }

  const fixture = {
    keys,
    supplierAccount: SME_ACCOUNT,
    invoice: { ...ATTESTED_INVOICE, amountCents: ATTESTED_INVOICE.amountCents.toString() },
    networkId: NETWORK_ID,
    registry: REGISTRY_ACCOUNT,
    file,
  };
  writeFileSync(ATTESTATION_FIXTURE_PATH, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`fixture écrit : ${ATTESTATION_FIXTURE_PATH}`);
}

try {
  await witnessFixture();
  await attestationFixture();
} finally {
  await releaseZkResources();
}
