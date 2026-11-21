// Sessions par cookie signé HMAC (httpOnly, SameSite=Lax, 7 jours), jeton d'inscription d'un wallet et garde de rôle
// des routes de chaque espace.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Role, UserRecord, UserStore } from "../../accounts/userStore.js";
import { HttpError } from "./errors.js";

export const SESSION_COOKIE = "bari_session";
export const SESSION_TTL_S = 7 * 86_400;
/** Le temps de remplir le KYC léger après la signature du défi. */
export const WALLET_REGISTRATION_TTL_S = 15 * 60;
const WALLET_REGISTRATION_TAG = "wallet";
const MS_PER_SECOND = 1_000;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;

type SessionContext = { users: UserStore };

function signature(secret: Buffer, payload: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

/** Jeton `<champs>.<expiration en s>.<HMAC>` : sans état côté serveur, falsifiable seulement avec le secret. */
function seal(secret: Buffer, fields: string[], ttlS: number, nowMs: number): string {
  const payload = [...fields, Math.floor(nowMs / MS_PER_SECOND) + ttlS].join(".");
  return `${payload}.${signature(secret, payload).toString("base64url")}`;
}

/** Champs d'un jeton valide et non expiré. */
function unseal(secret: Buffer, token: string, nowMs: number): string[] | undefined {
  const parts = token.split(".");
  if (parts.length < 3) return undefined;
  const mac = parts.pop() ?? "";
  const expected = signature(secret, parts.join("."));
  const received = Buffer.from(mac, "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return undefined;
  const expiresAt = Number(parts.pop());
  return expiresAt * MS_PER_SECOND > nowMs ? parts : undefined;
}

export function issueSession(secret: Buffer, userId: string, nowMs = Date.now()): string {
  return seal(secret, [userId], SESSION_TTL_S, nowMs);
}

/** Identifiant de l'utilisateur d'un jeton de session valide et non expiré. */
export function readSession(secret: Buffer, token: string, nowMs = Date.now()): string | undefined {
  const fields = unseal(secret, token, nowMs);
  return fields?.length === 1 ? fields[0] : undefined;
}

/** Preuve qu'un wallet inconnu vient de signer le défi : elle autorise l'inscription de cette adresse, et rien d'autre. */
export function issueWalletRegistration(secret: Buffer, address: string, nowMs = Date.now()): string {
  return seal(secret, [WALLET_REGISTRATION_TAG, address], WALLET_REGISTRATION_TTL_S, nowMs);
}

/** Adresse d'un jeton d'inscription valide et non expiré. */
export function readWalletRegistration(secret: Buffer, token: string, nowMs = Date.now()): string | undefined {
  const fields = unseal(secret, token, nowMs);
  return fields?.length === 2 && fields[0] === WALLET_REGISTRATION_TAG ? fields[1] : undefined;
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_S}`;
}

export const CLEARED_SESSION_COOKIE = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const pair of (header ?? "").split(";")) {
    const separator = pair.indexOf("=");
    if (separator !== -1 && pair.slice(0, separator).trim() === name) return pair.slice(separator + 1).trim();
  }
  return undefined;
}

export function currentUser(context: SessionContext, request: FastifyRequest): UserRecord | undefined {
  const token = cookieValue(request.headers.cookie, SESSION_COOKIE);
  const userId = token === undefined ? undefined : readSession(context.users.sessionSecret, token);
  return userId === undefined ? undefined : context.users.findById(userId);
}

const sessionUsers = new WeakMap<FastifyRequest, UserRecord>();

/** `preHandler` d'une route d'espace : 401 sans session, 403 avec la session d'un autre rôle. */
export function requireRole(context: SessionContext, role: Role) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const user = currentUser(context, request);
    if (user === undefined) throw new HttpError(HTTP_UNAUTHORIZED, "Sign in to continue");
    if (user.role !== role) throw new HttpError(HTTP_FORBIDDEN, `This page is for ${role.replace("_", " ")} accounts`);
    sessionUsers.set(request, user);
  };
}

/** Utilisateur d'une requête passée par `requireRole(…, role)`, typé selon son rôle. */
export function sessionUser<R extends Role>(request: FastifyRequest, role: R): Extract<UserRecord, { role: R }> {
  const user = sessionUsers.get(request);
  if (user?.role !== role) throw new Error(`Route sans requireRole("${role}")`);
  return user as Extract<UserRecord, { role: R }>;
}
