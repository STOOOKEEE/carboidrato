// Preuve et contrôle de signature du navigateur, exécutés ici sous Node avec les artefacts versionnés du circuit.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { AttestedInvoiceFile, PublicDebtor } from "../../../../src/api/contract";
import { proveInvoice, signatureIsValid } from "./prover";

interface ProverFixture {
  debtors: PublicDebtor[];
  file: AttestedInvoiceFile;
  threshold: string;
  vintage: string;
  nullifier: string;
}

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/witness.json", import.meta.url), "utf8"),
) as ProverFixture;

const artifacts = {
  wasm: fileURLToPath(new URL("../../../../circuits/artifacts/bari_invoice.wasm", import.meta.url)),
  zkey: fileURLToPath(new URL("../../../../circuits/build/bari_invoice_final.zkey", import.meta.url)),
};

function withAttestation(changes: Partial<AttestedInvoiceFile["attestation"]>): AttestedInvoiceFile {
  return { ...fixture.file, attestation: { ...fixture.file.attestation, ...changes } };
}

describe("prouveur du navigateur", () => {
  // snarkjs garde la courbe BN254 et ses workers sur globalThis : sans terminate, Node ne quitte pas.
  after(async () => {
    const curve = Reflect.get(globalThis, "curve_bn128") as { terminate(): Promise<void> } | undefined;
    await curve?.terminate();
  });

  test("la signature d'une facture attestée intacte est reconnue", async () => {
    assert.equal(await signatureIsValid(fixture.file, artifacts.wasm), true);
  });

  test("un montant modifié après signature est refusé", async () => {
    const forged = withAttestation({ amountCents: (BigInt(fixture.file.attestation.amountCents) + 1n).toString() });
    assert.equal(await signatureIsValid(forged, artifacts.wasm), false);
  });

  test("une signature attribuée à un autre débiteur est refusée", async () => {
    const other = fixture.debtors.find(({ publicKey }) => publicKey.ax !== fixture.file.attestation.debtorPublicKey.ax);
    assert.ok(other);
    assert.equal(await signatureIsValid(withAttestation({ debtorPublicKey: other.publicKey }), artifacts.wasm), false);
  });

  test("la preuve expose N et le seuil, jamais le montant", async () => {
    const { proof, publicSignals, durationMs } = await proveInvoice(
      {
        file: fixture.file,
        debtors: fixture.debtors,
        threshold: BigInt(fixture.threshold),
        vintage: BigInt(fixture.vintage),
      },
      artifacts,
    );
    assert.equal(proof.protocol, "groth16");
    assert.ok(publicSignals.includes(BigInt(`0x${fixture.nullifier}`).toString()));
    assert.ok(publicSignals.includes(fixture.threshold));
    assert.ok(!publicSignals.includes(fixture.file.attestation.amountCents));
    assert.ok(durationMs > 0);
  });
});
