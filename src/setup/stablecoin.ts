// Stablecoin de test « EURc » : MPT transférable. Le flag CanHoldConfidentialBalance est gardé (accepté comme
// actif de Vault, vérifié sur devnet) pour rester compatible avec XLS-96, hors périmètre de la démo.

import { MPTokenIssuanceCreateFlags, encodeMPTokenMetadata, type Client, type Wallet } from "xrpl";
import { STABLECOIN_ASSET_SCALE } from "../config/finance.js";
import { createdMptIssuanceId } from "../xrpl/meta.js";
import { submitTx } from "../xrpl/submit.js";

const STABLECOIN_METADATA = {
  ticker: "EURC",
  name: "Euro coin de test (IXH26)",
  icon: "https://xrpl.org/favicon.ico",
  asset_class: "rwa",
  asset_subclass: "stablecoin",
  issuer_name: "stable_issuer (démo)",
};

/**
 * Pas de TransferFee ni de RequireAuth (évite d'autoriser le pseudo-compte du Vault).
 * CanTransfer est obligatoire pour un actif de Vault.
 */
export async function createStablecoin(client: Client, issuer: Wallet): Promise<string> {
  const outcome = await submitTx(
    client,
    {
      TransactionType: "MPTokenIssuanceCreate",
      Account: issuer.address,
      AssetScale: STABLECOIN_ASSET_SCALE,
      Flags:
        MPTokenIssuanceCreateFlags.tfMPTCanTransfer | MPTokenIssuanceCreateFlags.tfMPTCanHoldConfidentialBalance,
      MPTokenMetadata: encodeMPTokenMetadata(STABLECOIN_METADATA),
    },
    issuer,
    "MPTokenIssuanceCreate EURc",
  );
  return createdMptIssuanceId(outcome.meta);
}
