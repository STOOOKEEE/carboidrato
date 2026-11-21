// RLUSD du fonds, jeton de ligne de confiance : sur un réseau de test, l'émetteur de test de Bari active le rippling,
// chaque détenteur ouvre sa ligne de confiance, puis l'émetteur verse les soldes par Payment.

import { AccountSetAsfFlags, LedgerEntry, type Client, type Wallet } from "xrpl";
import type { Actors } from "../accounts/actors.js";
import type { NetworkConfig } from "../config/network.js";
import { formatRlusd } from "../lib/amounts.js";
import { RLUSD_CURRENCY, findTrustLine, stablecoinPayment, trustLine, type Stablecoin } from "../xrpl/stablecoin.js";
import { submitTx } from "../xrpl/submit.js";

/** RLUSD de l'émetteur configuré (RLUSD_ISSUER), sinon de l'émetteur de test de Bari. */
export function fundStablecoin(network: NetworkConfig, actors: Actors): Stablecoin {
  return { currency: RLUSD_CURRENCY, issuer: network.rlusdIssuer ?? actors.stable_issuer.address };
}

/**
 * asfDefaultRipple, posé avant toute ligne de confiance : les RLUSD passent d'un détenteur à l'autre par l'émetteur.
 * Idempotent : rien n'est soumis si le flag est déjà actif.
 */
export async function enableRippling(client: Client, issuer: Wallet): Promise<void> {
  const { result } = await client.request({ command: "account_info", account: issuer.address, ledger_index: "validated" });
  if ((result.account_data.Flags & LedgerEntry.AccountRootFlags.lsfDefaultRipple) !== 0) return;
  await submitTx(
    client,
    { TransactionType: "AccountSet", Account: issuer.address, SetFlag: AccountSetAsfFlags.asfDefaultRipple },
    issuer,
    "AccountSet asfDefaultRipple (émetteur RLUSD)",
  );
}

/** Ligne de confiance d'un détenteur, ouverte une seule fois : elle sert à tous les fonds du même actif. */
export async function ensureTrustLine(client: Client, asset: Stablecoin, holder: Wallet, holderName: string): Promise<void> {
  if ((await findTrustLine(client, asset, holder.address)) !== undefined) return;
  await submitTx(client, trustLine(asset, holder.address), holder, `TrustSet RLUSD (${holderName})`);
}

/** Émission : Payment de l'émetteur vers un détenteur qui a déjà sa ligne de confiance. */
export async function issueStablecoin(
  client: Client,
  asset: Stablecoin,
  issuer: Wallet,
  to: string,
  units: bigint,
  holderName: string,
): Promise<void> {
  await submitTx(client, stablecoinPayment(asset, issuer.address, to, units), issuer, `Payment RLUSD → ${holderName} (${formatRlusd(units, 2)})`);
}
