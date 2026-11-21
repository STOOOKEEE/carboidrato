// Financement des comptes : faucet public, ou wallet genesis d'un nœud standalone (XRPL_GENESIS_SEED).

import { Wallet, xrpToDrops, type Client } from "xrpl";
import type { NetworkConfig } from "../config/network.js";
import { rippledErrorCode } from "../xrpl/rippledError.js";
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

/** Active le wallet d'un utilisateur, connu par sa seule adresse, s'il n'existe pas encore sur le ledger. */
export type ActivateAddress = (address: string) => Promise<void>;

async function accountExists(client: Client, address: string): Promise<boolean> {
  try {
    await client.request({ command: "account_info", account: address, ledger_index: "validated" });
    return true;
  } catch (error) {
    if (rippledErrorCode(error) === "actNotFound") return false;
    throw error;
  }
}

export function makeAddressActivator(client: Client, network: NetworkConfig): ActivateAddress {
  const fund = makeFunder(client, network);
  return async (address) => {
    if (await accountExists(client, address)) return;
    // Clés jetables, jamais utilisées pour signer : le financement ne lit que l'adresse (`masterAddress`).
    const carrier = Wallet.generate();
    await fund(new Wallet(carrier.publicKey, carrier.privateKey, { masterAddress: address }), `wallet ${address}`);
  };
}
