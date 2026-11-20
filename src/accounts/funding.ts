// Financement des comptes : faucet public, ou wallet genesis d'un nœud standalone (XRPL_GENESIS_SEED).

import { Wallet, xrpToDrops, type Client } from "xrpl";
import type { NetworkConfig } from "../config/network.js";
import { submitTx } from "../xrpl/submit.js";

/** XRP versés à chaque compte depuis le genesis (le faucet décide lui-même du montant). */
const GENESIS_FUNDING_XRP = 1_000;

export type FundAccount = (wallet: Wallet, name: string) => Promise<void>;

export function makeFunder(client: Client, network: NetworkConfig): FundAccount {
  const { genesisSeed } = network;
  if (genesisSeed !== undefined) {
    const genesis = Wallet.fromSeed(genesisSeed);
    return async (wallet, name) => {
      await submitTx(
        client,
        {
          TransactionType: "Payment",
          Account: genesis.address,
          Destination: wallet.address,
          Amount: xrpToDrops(GENESIS_FUNDING_XRP),
        },
        genesis,
        `Payment genesis → ${name}`,
      );
    };
  }
  return async (wallet) => {
    await client.fundWallet(wallet, { faucetHost: network.faucetHost });
  };
}
