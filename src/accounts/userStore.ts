// Comptes des utilisateurs de Bari (fichier gitignoré) : mot de passe haché scrypt, compte XRPL géré, secret de session.

import { randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";

const derive = promisify(scrypt) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;

const FILE_MODE_OWNER_ONLY = 0o600;
const SALT_BYTES = 16;
const HASH_BYTES = 64;
const SESSION_SECRET_BYTES = 32;
const WHITESPACE = /\s+/g;

export const ROLES = ["lender", "business", "public_body"] as const;
export type Role = (typeof ROLES)[number];

export interface LenderProfile {
  name: string;
  /** Code pays ISO 3166-1 alpha-2. */
  country: string;
}

export interface BusinessProfile {
  company: string;
  /** N° de TVA normalisé : majuscules, sans espaces. */
  vatNumber: string;
}

export interface PublicBodyProfile {
  /** Code IPA de l'organisme dans le registre des débiteurs vérifiés. */
  ipaCode: string;
  name: string;
}

export type AccountProfile =
  | { role: "lender"; profile: LenderProfile }
  | { role: "business"; profile: BusinessProfile }
  | { role: "public_body"; profile: PublicBodyProfile };

export type NewUser = AccountProfile & { email: string; password: string };

/** Compte XRPL ouvert et géré par Bari pour l'utilisateur : la seed ne sort jamais de l'API. */
export interface ManagedAccount {
  address: string;
  seed: string;
}

/** Ouvre le compte XRPL d'un nouvel utilisateur (aucun pour un organisme public). */
export type ProvisionAccount = (account: AccountProfile) => Promise<ManagedAccount | undefined>;

interface PasswordHash {
  salt: string;
  hash: string;
}

export type UserRecord = AccountProfile & {
  id: string;
  email: string;
  password: PasswordHash;
  account?: ManagedAccount;
  createdAt: string;
};

interface UsersFile {
  sessionSecret: string;
  users: UserRecord[];
}

export type DuplicateField = "email" | "vatNumber" | "publicBody";

export class DuplicateUser extends Error {
  constructor(readonly field: DuplicateField) {
    super(`Already registered: ${field}`);
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeVat(vatNumber: string): string {
  return vatNumber.replace(WHITESPACE, "").toUpperCase();
}

async function hashPassword(password: string): Promise<PasswordHash> {
  const salt = randomBytes(SALT_BYTES);
  return { salt: salt.toString("hex"), hash: (await derive(password, salt, HASH_BYTES)).toString("hex") };
}

async function passwordMatches(password: string, stored: PasswordHash): Promise<boolean> {
  const expected = Buffer.from(stored.hash, "hex");
  return timingSafeEqual(await derive(password, Buffer.from(stored.salt, "hex"), HASH_BYTES), expected);
}

/** Haché factice : un email inconnu coûte le même temps qu'un mauvais mot de passe. */
const DECOY_HASH: PasswordHash = { salt: "00".repeat(SALT_BYTES), hash: "00".repeat(HASH_BYTES) };

function isUsersFile(value: unknown): value is UsersFile {
  if (typeof value !== "object" || value === null) return false;
  const { sessionSecret, users } = value as Record<string, unknown>;
  return typeof sessionSecret === "string" && Array.isArray(users);
}

function normalized(user: NewUser): AccountProfile {
  if (user.role !== "business") return user;
  return { role: "business", profile: { ...user.profile, vatNumber: normalizeVat(user.profile.vatNumber) } };
}

export class UserStore {
  private readonly data: UsersFile;

  constructor(private readonly file: string) {
    this.data = this.load();
  }

  /** Clé HMAC des cookies de session, créée au premier lancement puis conservée dans le fichier. */
  get sessionSecret(): Buffer {
    return Buffer.from(this.data.sessionSecret, "hex");
  }

  findById(id: string): UserRecord | undefined {
    return this.data.users.find((user) => user.id === id);
  }

  findBusinessByVat(vatNumber: string): Extract<UserRecord, { role: "business" }> | undefined {
    const wanted = normalizeVat(vatNumber);
    return this.data.users.find(
      (user): user is Extract<UserRecord, { role: "business" }> =>
        user.role === "business" && user.profile.vatNumber === wanted,
    );
  }

  hasPublicBody(ipaCode: string): boolean {
    return this.data.users.some((user) => user.role === "public_body" && user.profile.ipaCode === ipaCode);
  }

  /** Lève `DuplicateUser` si l'email, le n° de TVA ou l'organisme public a déjà un compte. */
  assertAvailable(user: NewUser): void {
    const email = normalizeEmail(user.email);
    if (this.data.users.some((existing) => existing.email === email)) throw new DuplicateUser("email");
    if (user.role === "business" && this.findBusinessByVat(user.profile.vatNumber) !== undefined) {
      throw new DuplicateUser("vatNumber");
    }
    if (user.role === "public_body" && this.hasPublicBody(user.profile.ipaCode)) throw new DuplicateUser("publicBody");
  }

  async create(user: NewUser, account: ManagedAccount | undefined): Promise<UserRecord> {
    this.assertAvailable(user);
    const password = await hashPassword(user.password);
    // Revérifié après le hachage asynchrone : une inscription concurrente a pu passer entre-temps.
    this.assertAvailable(user);
    const record: UserRecord = {
      ...normalized(user),
      id: randomUUID(),
      email: normalizeEmail(user.email),
      password,
      ...(account === undefined ? {} : { account }),
      createdAt: new Date().toISOString(),
    };
    this.data.users.push(record);
    this.save();
    return record;
  }

  async authenticate(email: string, password: string): Promise<UserRecord | undefined> {
    const user = this.data.users.find((candidate) => candidate.email === normalizeEmail(email));
    const matches = await passwordMatches(password, user?.password ?? DECOY_HASH);
    return matches ? user : undefined;
  }

  private load(): UsersFile {
    if (!existsSync(this.file)) {
      const fresh = { sessionSecret: randomBytes(SESSION_SECRET_BYTES).toString("hex"), users: [] };
      this.write(fresh);
      return fresh;
    }
    const parsed: unknown = JSON.parse(readFileSync(this.file, "utf8"));
    if (!isUsersFile(parsed)) throw new Error(`Format inattendu dans ${this.file}`);
    return parsed;
  }

  private save(): void {
    this.write(this.data);
  }

  /** Écriture atomique, lisible par le seul propriétaire : le fichier contient les seeds des comptes gérés. */
  private write(data: UsersFile): void {
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: FILE_MODE_OWNER_ONLY });
    renameSync(temporary, this.file);
  }
}
