/** Route de l'app ; les autres ancres (#simulate, #how) restent sur la landing. */
export const APP_ROUTE = "#/app";
export const LANDING_ROUTE = "#";
const TX_ROUTE_PREFIX = "#/tx/";

/** Page de détail d'une transaction dans l'app (l'AlphaNet n'a pas d'explorer). */
export const txRoute = (hash: string) => `${TX_ROUTE_PREFIX}${hash}`;

export function txHashFromRoute(route: string): string | undefined {
  return route.startsWith(TX_ROUTE_PREFIX) ? route.slice(TX_ROUTE_PREFIX.length) : undefined;
}
