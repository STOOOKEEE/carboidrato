// Comptes des utilisateurs de Bari (fichier gitignoré) : compte géré (mot de passe haché scrypt, compte XRPL géré) ou
// wallet de l'utilisateur (adresse seule, sans seed), secret de session.

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

/** Rôles ouverts à la connexion par wallet : un organisme public n'a pas de compte XRPL. */
export const WALLET_ROLES = ["lender", "business"] as const;
export type WalletRole = (typeof WALLET_ROLES)[number];

export type NewWalletUser = Extract<AccountProfile, { role: WalletRole }> & { address: string };

/** Compte XRPL ouvert et géré par Bari pour l'utilisateur : la seed ne sort jamais de l'API. */
export interface ManagedAccount {
  address: string;
  seed: string;
}

/** Ouvre le compte XRPL d'un nouvel utilisateur (aucun pour un organisme public). */
export type ProvisionAccount = (account: AccountProfile) => Promise<ManagedAccount | undefined>;

/** Prix de revient d'un prêteur, en unités : parts suivies et RLUSD payés pour elles. */
export interface CostBasis {
  shares: bigint;
  cost: bigint;
}

const NO_COST_BASIS: CostBasis = { shares: 0n, cost: 0n };

interface PasswordHash {
  salt: string;
  hash: string;
}

/** `managed` : email et mot de passe, compte XRPL géré par Bari ; `wallet` : l'utilisateur signe avec son wallet. */
type Custody =
  | { custody: "managed"; email: string; password: PasswordHash; address?: undefined }
  | { custody: "wallet"; address: string; email?: undefined; password?: undefined };

export type UserRecord = AccountProfile &
  Custody & {
    id: string;
    account?: ManagedAccount;
    /** Prix de revient (prêteur), entiers en décimal ; absent tant que le prêteur n'a rien acheté. */
    costBasis?: { shares: string; cost: string };
    createdAt: string;
  };

interface UsersFile {
  sessionSecret: string;
  users: UserRecord[];
}

export type DuplicateField = "email" | "vatNumber" | "publicBody" | "address";

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

/** Compte XRPL de l'utilisateur : son wallet, ou le compte que Bari gère pour lui (absent pour un organisme public). */
export function userAddress(user: UserRecord): string | undefined {
  return user.custody === "wallet" ? user.address : user.account?.address;
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

function normalized(account: AccountProfile): AccountProfile {
  if (account.role !== "business") return { role: account.role, profile: account.profile } as AccountProfile;
  return { role: "business", profile: { ...account.profile, vatNumber: normalizeVat(account.profile.vatNumber) } };
}

/** Comptes enregistrés avant la connexion par wallet : sans `custody`, ils sont gérés. */
function withCustody(user: UserRecord | Omit<UserRecord, "custody">): UserRecord {
  return "custody" in user && user.custody !== undefined ? user : ({ ...user, custody: "managed" } as UserRecord);
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

  findByEmail(email: string): UserRecord | undefined {
    const wanted = normalizeEmail(email);
    return this.data.users.find((user) => user.email === wanted);
  }

  /** Utilisateur dont le compte XRPL est `address` : son wallet, ou le compte que Bari gère pour lui. */
  findByAddress(address: string): UserRecord | undefined {
    return this.data.users.find((user) => userAddress(user) === address);
  }

  findPublicBody(ipaCode: string): Extract<UserRecord, { role: "public_body" }> | undefined {
    return this.data.users.find(
      (user): user is Extract<UserRecord, { role: "public_body" }> =>
        user.role === "public_body" && user.profile.ipaCode === ipaCode,
    );
  }

  hasPublicBody(ipaCode: string): boolean {
    return this.findPublicBody(ipaCode) !== undefined;
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
    return this.add({
      ...normalized(user),
      custody: "managed",
      id: randomUUID(),
      email: normalizeEmail(user.email),
      password,
      ...(account === undefined ? {} : { account }),
      createdAt: new Date().toISOString(),
    });
  }

  /** Lève `DuplicateUser` si l'adresse ou le n° de TVA a déjà un compte. */
  createWalletUser(user: NewWalletUser): UserRecord {
    if (this.findByAddress(user.address) !== undefined) throw new DuplicateUser("address");
    if (user.role === "business" && this.findBusinessByVat(user.profile.vatNumber) !== undefined) {
      throw new DuplicateUser("vatNumber");
    }
    return this.add({
      ...normalized(user),
      custody: "wallet",
      id: randomUUID(),
      address: user.address,
      createdAt: new Date().toISOString(),
    });
  }

  async authenticate(email: string, password: string): Promise<UserRecord | undefined> {
    const user = this.data.users.find(
      (candidate) => candidate.custody === "managed" && candidate.email === normalizeEmail(email),
    );
    const matches = await passwordMatches(password, user?.password ?? DECOY_HASH);
    return matches ? user : undefined;
  }

  private add(record: UserRecord): UserRecord {
    this.data.users.push(record);
    this.save();
    return record;
  }

  remove(userId: string): void {
    this.data.users = this.data.users.filter((user) => user.id !== userId);
    this.save();
  }

  costBasis(userId: string): CostBasis {
    const stored = this.findById(userId)?.costBasis;
    return stored === undefined ? NO_COST_BASIS : { shares: BigInt(stored.shares), cost: BigInt(stored.cost) };
  }

  recordPurchase(userId: string, bought: CostBasis): void {
    const { shares, cost } = this.costBasis(userId);
    this.setCostBasis(userId, { shares: shares + bought.shares, cost: cost + bought.cost });
  }

  /** Le coût sort au prorata des parts vendues : le prix moyen des parts restantes ne change pas. */
  recordSale(userId: string, sold: bigint): void {
    const { shares, cost } = this.costBasis(userId);
    this.setCostBasis(userId, sold >= shares ? NO_COST_BASIS : { shares: shares - sold, cost: cost - (cost * sold) / shares });
  }

  private setCostBasis(userId: string, basis: CostBasis): void {
    const user = this.findById(userId);
    if (user === undefined) throw new Error(`Utilisateur inconnu : ${userId}`);
    user.costBasis = { shares: basis.shares.toString(), cost: basis.cost.toString() };
    this.save();
  }

  private load(): UsersFile {
    if (!existsSync(this.file)) {
      const fresh = { sessionSecret: randomBytes(SESSION_SECRET_BYTES).toString("hex"), users: [] };
      this.write(fresh);
      return fresh;
    }
    const parsed: unknown = JSON.parse(readFileSync(this.file, "utf8"));
    if (!isUsersFile(parsed)) throw new Error(`Format inattendu dans ${this.file}`);
    return { ...parsed, users: parsed.users.map(withCustody) };
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
