// Routes de l'app (hash) et garde des espaces : un espace par rôle, ouvert à la seule session de ce rôle.

import type { AccountView, UserRole } from "../../src/api/contract";

export type Route =
  | { page: "landing" }
  | { page: "signin" }
  | { page: "signup"; role: UserRole }
  | { page: "space"; role: UserRole }
  | { page: "transparency" }
  | { page: "tx"; hash: string };

export type SessionState = { status: "loading" } | { status: "signedOut" } | { status: "signedIn"; user: AccountView };

export type Guard =
  | { kind: "show" }
  | { kind: "loading" }
  | { kind: "signin"; role: UserRole }
  | { kind: "wrongRole"; required: UserRole; user: AccountView }
  | { kind: "redirect"; to: string };

export const LANDING_ROUTE = "#/";
export const SIGNIN_ROUTE = "#/signin";
export const TRANSPARENCY_ROUTE = "#/transparency";
const TX_ROUTE_PREFIX = "#/tx/";
const SIGNUP_ROUTE_PREFIX = "#/signup/";

const SPACE_ROUTES: Record<UserRole, string> = { lender: "#/lend", business: "#/business", public_body: "#/public" };
const ROLES = Object.keys(SPACE_ROUTES) as UserRole[];

export const spaceRoute = (role: UserRole) => SPACE_ROUTES[role];
export const signupRoute = (role: UserRole) => `${SIGNUP_ROUTE_PREFIX}${role}`;

/** Page de détail d'une transaction dans l'app (l'AlphaNet n'a pas d'explorer). */
export const txRoute = (hash: string) => `${TX_ROUTE_PREFIX}${hash}`;

export function txHashFromRoute(route: string): string | undefined {
  return route.startsWith(TX_ROUTE_PREFIX) ? route.slice(TX_ROUTE_PREFIX.length) : undefined;
}

const isRole = (value: string): value is UserRole => (ROLES as string[]).includes(value);

export function parseRoute(hash: string): Route {
  const txHash = txHashFromRoute(hash);
  if (txHash !== undefined) return { page: "tx", hash: txHash };
  if (hash === SIGNIN_ROUTE) return { page: "signin" };
  if (hash === TRANSPARENCY_ROUTE) return { page: "transparency" };
  if (hash.startsWith(SIGNUP_ROUTE_PREFIX)) {
    const role = hash.slice(SIGNUP_ROUTE_PREFIX.length);
    if (isRole(role)) return { page: "signup", role };
  }
  const space = ROLES.find((role) => SPACE_ROUTES[role] === hash);
  return space === undefined ? { page: "landing" } : { page: "space", role: space };
}

export function guardRoute(route: Route, session: SessionState): Guard {
  if (route.page === "signin") {
    return session.status === "signedIn" ? { kind: "redirect", to: spaceRoute(session.user.role) } : { kind: "show" };
  }
  if (route.page !== "space") return { kind: "show" };
  switch (session.status) {
    case "loading":
      return { kind: "loading" };
    case "signedOut":
      return { kind: "signin", role: route.role };
    case "signedIn":
      return session.user.role === route.role
        ? { kind: "show" }
        : { kind: "wrongRole", required: route.role, user: session.user };
  }
}
