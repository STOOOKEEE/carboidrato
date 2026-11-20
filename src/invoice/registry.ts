// Registre anti double-financement (IDEE §7.5 idée 2) : CredentialCreate(Issuer = PME, Subject = registre Bari,
// CredentialType = N). L'identifiant du credential dérive de (sujet, émetteur, type) : un second enregistrement
// du même N par la même PME est refusé par le ledger (tecDUPLICATE). On ne supprime jamais un enregistrement.

import type { Client, CredentialCreate, LedgerEntry, Wallet } from "xrpl";
import type { Ledger } from "../xrpl/ledger.js";
import { submitTx } from "../xrpl/submit.js";

const DUPLICATE_RESULT = "tecDUPLICATE";
const HASH_32_PATTERN = /^[0-9A-F]{64}$/;

export function assertHash32(value: string, label: string): void {
  if (!HASH_32_PATTERN.test(value)) throw new Error(`${label} invalide (32 octets hex majuscules attendus) : ${value}`);
}

/** Enregistrement de N émis par la PME, lu en un seul ledger_entry (sans scan d'historique). */
export function getRegistration(
  ledger: Ledger,
  registry: string,
  sme: string,
  nullifier: string,
): Promise<LedgerEntry.Credential | undefined> {
  assertHash32(nullifier, "Empreinte N");
  return ledger.credential(registry, sme, nullifier);
}

/** Transaction d'enregistrement de N (seule ou dans le Batch du certificat). */
export function nullifierRegistrationTx(sme: string, registry: string, nullifier: string): CredentialCreate {
  assertHash32(nullifier, "Empreinte N");
  return { TransactionType: "CredentialCreate", Account: sme, Subject: registry, CredentialType: nullifier };
}

/** Enregistre N. Renvoie false si la facture était déjà enregistrée (tecDUPLICATE). */
export async function registerNullifier(client: Client, sme: Wallet, registry: string, nullifier: string) {
  const outcome = await submitTx(
    client,
    nullifierRegistrationTx(sme.address, registry, nullifier),
    sme,
    `CredentialCreate registre N=${nullifier.slice(0, 8)}…`,
    ["tesSUCCESS", DUPLICATE_RESULT],
  );
  return outcome.result !== DUPLICATE_RESULT;
}
