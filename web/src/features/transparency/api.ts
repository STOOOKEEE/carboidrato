// Appels de la page Transparency : audit public du fonds et clé publique de vérification des preuves.

import type { FundAudit } from "../../../../src/api/contract";
import { request } from "../../api";

const VERIFICATION_KEY_FILE = "verification_key.json";

export const fetchAudit = () => request<FundAudit>("/api/audit");

/** Clé de vérification Groth16, à l'adresse publiée par `GET /api/zk`. */
export async function fetchVerificationKey(): Promise<unknown> {
  const artifacts = await request<Record<string, string>>("/api/zk");
  const url = artifacts[VERIFICATION_KEY_FILE];
  if (url === undefined) throw new Error("Bari's server does not publish the verification key.");
  return request<unknown>(url);
}
