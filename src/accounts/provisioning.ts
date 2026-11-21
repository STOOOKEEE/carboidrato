// Ouverture du compte XRPL géré d'un nouvel utilisateur : créé et financé par Bari, aucun pour un organisme public.

import { Wallet, type Client } from "xrpl";
import type { NetworkConfig } from "../config/network.js";
import { makeFunder } from "./funding.js";
import type { ProvisionAccount } from "./userStore.js";

export function makeProvisioner(client: Client, network: NetworkConfig): ProvisionAccount {
  const fund = makeFunder(client, network);
  return async ({ role }) => {
    if (role === "public_body") return undefined;
    const wallet = Wallet.generate();
    if (wallet.seed === undefined) throw new Error("Wallet généré sans seed");
    await fund(wallet, role);
    return { address: wallet.address, seed: wallet.seed };
  };
}
