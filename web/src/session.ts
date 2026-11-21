// Session du navigateur : compte lu de `GET /api/me` au chargement, mis à jour à la connexion et à la déconnexion.

import { useSyncExternalStore } from "react";
import type { AccountView } from "../../src/api/contract";
import { fetchMe, signOutSession } from "./api";
import type { SessionState } from "./routes";

let current: SessionState = { status: "loading" };
const listeners = new Set<() => void>();

function publish(next: SessionState): void {
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const useSession = () => useSyncExternalStore(subscribe, () => current);

/** Sans API joignable, le visiteur est traité comme déconnecté : les pages publiques restent lisibles. */
export function loadSession(): void {
  fetchMe()
    .then((user) => publish(user === undefined ? { status: "signedOut" } : { status: "signedIn", user }))
    .catch(() => publish({ status: "signedOut" }));
}

export const sessionStarted = (user: AccountView) => publish({ status: "signedIn", user });

export async function signOut(): Promise<void> {
  await signOutSession();
  publish({ status: "signedOut" });
}
