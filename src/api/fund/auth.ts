// Sessions par cookie signé HMAC (httpOnly, SameSite=Lax, 7 jours) et garde de rôle des routes de chaque espace.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Role, UserRecord, UserStore } from "../../accounts/userStore.js";
import { HttpError } from "./errors.js";

export const SESSION_COOKIE = "bari_session";
export const SESSION_TTL_S = 7 * 86_400;
const MS_PER_SECOND = 1_000;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;

type SessionContext = { users: UserStore };

function signature(secret: Buffer, payload: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

/** Jeton `<id>.<expiration en s>.<HMAC>` : sans état côté serveur, falsifiable seulement avec le secret. */
export function issueSession(secret: Buffer, userId: string, nowMs = Date.now()): string {
  const payload = `${userId}.${Math.floor(nowMs / MS_PER_SECOND) + SESSION_TTL_S}`;
  return `${payload}.${signature(secret, payload).toString("base64url")}`;
}

/** Identifiant de l'utilisateur d'un jeton valide et non expiré. */
export function readSession(secret: Buffer, token: string, nowMs = Date.now()): string | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  const [userId, expiresAt, mac] = parts;
  const expected = signature(secret, `${userId}.${expiresAt}`);
  const received = Buffer.from(mac, "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return undefined;
  return Number(expiresAt) * MS_PER_SECOND > nowMs ? userId : undefined;
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
