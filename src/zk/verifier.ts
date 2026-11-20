// Vérification d'une preuve par Bari ou par n'importe quel investisseur : la preuve elle-même,
// puis chaque entrée publique confrontée aux valeurs attendues (annexe C, dernier piège).

import { readFile } from "node:fs/promises";
import { groth16 } from "snarkjs";
import { VERIFICATION_KEY_PATH } from "./constants.js";
import { accountToField } from "./field.js";
import { parsePublicSignals, type InvoiceProof, type InvoiceStatement, type PublicSignalName } from "./statement.js";

/** Valeurs que le vérificateur lit sur le ledger ou dans le prêt, pas dans la preuve. */
export interface ExpectedPublicInputs {
  /** Racine publiée on-chain de la liste des débiteurs. */
  debtorsRoot: bigint;
  /** PME = émetteur du MPT facture = emprunteur. */
  account: string;
  threshold: bigint;
  dueDate: bigint;
  networkId: number;
  /** Registre Bari. */
  registry: string;
  vintage: bigint;
}

export type VerificationResult =
  | { valid: true; statement: InvoiceStatement }
  | { valid: false; reason: string };

let verificationKey: Promise<unknown> | undefined;

export async function verify(invoiceProof: InvoiceProof, expected: ExpectedPublicInputs): Promise<VerificationResult> {
  let statement: InvoiceStatement;
  try {
    statement = parsePublicSignals(invoiceProof.publicSignals);
  } catch (error) {
    return { valid: false, reason: error instanceof Error ? error.message : String(error) };
  }

  const expectedValues: [PublicSignalName, bigint][] = [
    ["debtorsRoot", expected.debtorsRoot],
    ["account", accountToField(expected.account)],
    ["threshold", expected.threshold],
    ["dueDate", expected.dueDate],
    ["networkId", BigInt(expected.networkId)],
    ["registry", accountToField(expected.registry)],
    ["vintage", expected.vintage],
  ];
  const mismatch = expectedValues.find(([name, value]) => statement[name] !== value);
  if (mismatch) {
    return { valid: false, reason: `Entrée publique inattendue : ${mismatch[0]}` };
  }

  verificationKey ??= readFile(VERIFICATION_KEY_PATH, "utf8").then((json): unknown => JSON.parse(json));
  const proofValid = await groth16.verify(await verificationKey, invoiceProof.publicSignals, invoiceProof.proof);
  return proofValid ? { valid: true, statement } : { valid: false, reason: "Preuve Groth16 invalide" };
}
