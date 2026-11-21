// Comptes du pitch (prêteur, fournisseur des factures, Comune di Bari) : définitions, réutilisation, fichier des identifiants.

import { randomBytes } from "node:crypto";
import type { AccountProfile, UserRecord, UserStore } from "../accounts/userStore.js";
import { DEMO_DEBTOR } from "../invoice/debtors.js";
import { PITCH_SUPPLIER } from "./sampleInvoices.js";

export type PitchAccount = AccountProfile & { email: string };

export const PITCH_ACCOUNTS: readonly PitchAccount[] = [
  { email: "giulia.ferri@bari.example", role: "lender", profile: { name: "Giulia Ferri", country: "IT" } },
  {
    email: "amministrazione@asfaltisparano.example",
    role: "business",
    profile: { company: PITCH_SUPPLIER.name, vatNumber: PITCH_SUPPLIER.vatNumber },
  },
  { email: "ragioneria@comune.bari.example", role: "public_body", profile: { ...DEMO_DEBTOR } },
];

export type PitchPlan = { action: "reuse"; user: UserRecord } | { action: "create" } | { action: "conflict"; reason: string };

type UserLookup = Pick<UserStore, "findByEmail" | "findBusinessByVat" | "findPublicBody">;

/** Réutilise le compte du même email et du même rôle ; signale tout compte qui empêcherait l'inscription. */
export function planPitchAccount(account: PitchAccount, users: UserLookup): PitchPlan {
  const existing = users.findByEmail(account.email);
  if (existing !== undefined) {
    if (existing.role === account.role) return { action: "reuse", user: existing };
    return { action: "conflict", reason: `${account.email} is already a ${existing.role} account` };
  }
  const holder =
    account.role === "business"
      ? users.findBusinessByVat(account.profile.vatNumber)
      : account.role === "public_body"
        ? users.findPublicBody(account.profile.ipaCode)
        : undefined;
  if (holder !== undefined) {
    const what = account.role === "business" ? `VAT ${account.profile.vatNumber}` : account.profile.name;
    return { action: "conflict", reason: `${what} already has an account under ${holder.email}` };
  }
  return { action: "create" };
}

export interface PitchCredential {
  email: string;
  role: string;
  password: string;
}

const PASSWORD_BYTES = 18;
const CREDENTIAL_ROW = /^\|\s*([^|\s]+@[^|\s]+)\s*\|\s*([^|\s]+)\s*\|\s*([^|\s]+)\s*\|$/;

/** 24 caractères base64url : ni espace ni barre verticale, lisibles dans le tableau Markdown. */
export function generatePassword(): string {
  return randomBytes(PASSWORD_BYTES).toString("base64url");
}

export function renderPitchCredentials(entries: readonly PitchCredential[]): string {
  const rows = entries.map(({ email, role, password }) => `| ${email} | ${role} | ${password} |`);
  return [
    "# Pitch accounts",
    "",
    "Written by `npm run demo:fund`. Local only, never commit.",
    "",
    "| Email | Role | Password |",
    "| --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

export function parsePitchCredentials(markdown: string): Map<string, string> {
  const passwords = new Map<string, string>();
  for (const line of markdown.split("\n")) {
    const match = CREDENTIAL_ROW.exec(line.trim());
    if (match !== null) passwords.set(match[1], match[3]);
  }
  return passwords;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-6)}`;
}
