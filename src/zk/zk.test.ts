// Tests du circuit Bari (IDEE §9, priorité 1). Prérequis : `npm run zk:setup`.

import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { after, before, describe, test } from "node:test";
import { encodeAccountID, encodeMPTokenMetadata } from "xrpl";
import {
  attestInvoice,
  buildDebtorList,
  decodeProofFromMetadata,
  deriveDebtor,
  DOMAIN_N,
  DOMAIN_P,
  encodeProofForMetadata,
  merklePath,
  MPT_METADATA_MAX_BYTES,
  prove,
  releaseZkResources,
  PUBLIC_SIGNAL_ORDER,
  statementHex,
  verify,
  type DebtorAttestation,
  type DebtorIdentity,
  type DebtorList,
  type ExpectedPublicInputs,
  type InvoiceClaim,
  type ProveInput,
  type ProvenInvoice,
} from "./index.js";
import { poseidon } from "./primitives.js";

const ACCOUNT_ID_BYTES = 20;
const SME_ACCOUNT = encodeAccountID(Buffer.alloc(ACCOUNT_ID_BYTES, 0x11));
const REGISTRY_ACCOUNT = encodeAccountID(Buffer.alloc(ACCOUNT_ID_BYTES, 0x22));
const DEVNET_NETWORK_ID = 2;
const XAHAU_NETWORK_ID = 21337;
const VINTAGE = 2026n;
const NEXT_VINTAGE = 2027n;
/** 10 000 $ en cents, seuil = avance de 90 %. */
const INVOICE_AMOUNT = 1_000_000n;
const THRESHOLD = 900_000n;
const DUE_DATE = 1_795_000_000n;
const HEX32 = /^[0-9A-F]{64}$/;

const claim: InvoiceClaim = {
  account: SME_ACCOUNT,
  amount: INVOICE_AMOUNT,
  dueDate: DUE_DATE,
  invoiceNumber: "IT-PA-2026-000123",
  networkId: DEVNET_NETWORK_ID,
  registry: REGISTRY_ACCOUNT,
};

const expected: ExpectedPublicInputs = {
  debtorsRoot: 0n,
  account: SME_ACCOUNT,
  threshold: THRESHOLD,
  dueDate: DUE_DATE,
  networkId: DEVNET_NETWORK_ID,
  registry: REGISTRY_ACCOUNT,
  vintage: VINTAGE,
};

let municipality: DebtorIdentity;
let outsider: DebtorIdentity;
let verifiedDebtors: DebtorList;
let attestation: DebtorAttestation;
let validProof: ProvenInvoice;

async function proveInput(attested: DebtorAttestation, vintage = VINTAGE): Promise<ProveInput> {
  return {
    attestation: attested,
    merklePath: await merklePath(verifiedDebtors, municipality.publicKey),
    debtorsRoot: verifiedDebtors.root,
    threshold: THRESHOLD,
    vintage,
  };
}

before(async () => {
  municipality = await deriveDebtor("Comune di Palermo");
  outsider = await deriveDebtor("Società schermo SRL");
  const others = await Promise.all(["Comune di Catania", "ASL Roma 1"].map(deriveDebtor));
  verifiedDebtors = await buildDebtorList([municipality, ...others].map((debtor) => debtor.publicKey));
  expected.debtorsRoot = verifiedDebtors.root;
  attestation = await attestInvoice(municipality, claim);
});

after(releaseZkResources);

describe("preuve valide", () => {
  test("une preuve est générée puis vérifiée", async (t) => {
    const start = performance.now();
    validProof = await prove(await proveInput(attestation));
    t.diagnostic(`temps de preuve : ${Math.round(performance.now() - start)} ms`);

    const result = await verify(validProof, expected);
    assert.equal(result.valid, true, result.valid ? "" : result.reason);
  });

  test("les sorties N, P, C et l'ordre des signaux correspondent à l'énoncé", async () => {
    const { statement, opening, publicSignals } = validProof;
    assert.equal(publicSignals.length, PUBLIC_SIGNAL_ORDER.length);
    assert.equal(statement.nullifier, await poseidon([DOMAIN_N, attestation.uuid]));
    assert.equal(
      statement.pseudonym,
      await poseidon([DOMAIN_P, municipality.publicKey.ax, municipality.publicKey.ay, VINTAGE]),
    );
    assert.equal(statement.commitment, await poseidon([opening.message, opening.blinding]));
    assert.equal(statement.debtorsRoot, verifiedDebtors.root);

    const hex = statementHex(statement);
    for (const value of Object.values(hex)) assert.match(value, HEX32);
  });
});

describe("tests négatifs", () => {
  test("montant modifié : aucune preuve possible", async () => {
    const tampered = { ...attestation, amount: attestation.amount + 1n };
    await assert.rejects(prove(await proveInput(tampered)));
  });

  test("signal public modifié après coup : preuve rejetée", async () => {
    const forgedThreshold = THRESHOLD - 1n;
    const publicSignals = [...validProof.publicSignals];
    publicSignals[PUBLIC_SIGNAL_ORDER.indexOf("threshold")] = forgedThreshold.toString();
    const result = await verify({ proof: validProof.proof, publicSignals }, { ...expected, threshold: forgedThreshold });
    assert.equal(result.valid, false);
  });

  test("mauvais networkId : aucune preuve possible, et vérification refusée", async () => {
    const replayed = { ...attestation, networkId: BigInt(XAHAU_NETWORK_ID) };
    await assert.rejects(prove(await proveInput(replayed)));

    const result = await verify(validProof, { ...expected, networkId: XAHAU_NETWORK_ID });
    assert.deepEqual(result, { valid: false, reason: "Entrée publique inattendue : networkId" });
  });

  test("débiteur hors liste : aucune preuve possible", async () => {
    await assert.rejects(merklePath(verifiedDebtors, outsider.publicKey));

    // Le fraudeur fabrique sa propre liste mais doit prouver contre la racine publiée.
    const rogueList = await buildDebtorList([outsider.publicKey]);
    const forged = await attestInvoice(outsider, claim);
    await assert.rejects(
      prove({
        attestation: forged,
        merklePath: await merklePath(rogueList, outsider.publicKey),
        debtorsRoot: verifiedDebtors.root,
        threshold: THRESHOLD,
        vintage: VINTAGE,
      }),
    );
  });

  test("montant inférieur au seuil : aucune preuve possible", async () => {
    const small = await attestInvoice(municipality, { ...claim, amount: THRESHOLD - 1n });
    await assert.rejects(prove(await proveInput(small)));
  });

  test("preuve présentée pour un autre compte : vérification refusée", async () => {
    const otherAccount = encodeAccountID(Buffer.alloc(ACCOUNT_ID_BYTES, 0x33));
    const result = await verify(validProof, { ...expected, account: otherAccount });
    assert.equal(result.valid, false);
  });
});

describe("pseudonyme P et empreinte N", () => {
  test("deux factures du même débiteur, même millésime : même P ; autre millésime : autre P", async () => {
    const secondInvoice = await attestInvoice(municipality, { ...claim, invoiceNumber: "IT-PA-2026-000456" });
    const second = await prove(await proveInput(secondInvoice));
    const nextVintage = await prove(await proveInput(secondInvoice, NEXT_VINTAGE));

    assert.equal(second.statement.pseudonym, validProof.statement.pseudonym);
    assert.notEqual(second.statement.nullifier, validProof.statement.nullifier);
    assert.notEqual(nextVintage.statement.pseudonym, validProof.statement.pseudonym);
  });

  test("même facture attestée deux fois : même N, engagement différent", async () => {
    const attestedAgain = await attestInvoice(municipality, claim);
    const again = await prove(await proveInput(attestedAgain));

    assert.equal(again.statement.nullifier, validProof.statement.nullifier);
    assert.notEqual(again.statement.commitment, validProof.statement.commitment);
  });
});

describe("métadonnées du MPT facture", () => {
  test("encodage compact ≤ 1024 octets, décodé puis vérifié", async (t) => {
    const encoded = encodeProofForMetadata(validProof);
    const decoded = decodeProofFromMetadata(encoded);
    assert.deepEqual(decoded.publicSignals, validProof.publicSignals);
    assert.equal((await verify(decoded, expected)).valid, true);

    // Métadonnées XLS-89 représentatives du MPT facture, preuve incluse.
    const metadataHex = encodeMPTokenMetadata({
      ticker: "FACT",
      name: `Facture ${statementHex(validProof.statement).nullifier.slice(0, 8)}`,
      icon: "https://xrpl.org/favicon.ico",
      asset_class: "rwa",
      asset_subclass: "private_credit",
      issuer_name: "Bari",
      additional_info: { zk: encoded },
    });
    const metadataBytes = metadataHex.length / 2;
    t.diagnostic(`preuve encodée : ${encoded.length} caractères base64 ; métadonnées XLS-89 : ${metadataBytes} octets`);
    assert.ok(metadataBytes <= MPT_METADATA_MAX_BYTES);
  });
});
