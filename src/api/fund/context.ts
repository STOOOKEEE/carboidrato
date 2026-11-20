// Dépendances partagées par les routes du serveur du fonds.

import type { Client } from "xrpl";
import type { Actors } from "../../accounts/actors.js";
import type { NetworkConfig } from "../../config/network.js";
import type { Ledger } from "../../xrpl/ledger.js";
import { fromHex } from "../../zk/index.js";
import { HttpError } from "./errors.js";
import type { EventHub } from "./events.js";
import type { OperationQueue } from "./operations.js";
import type { FundState, FundStateStore } from "./stateStore.js";
import type { ProofExpectations } from "./zkInputs.js";

const HTTP_NOT_FOUND = 404;

export interface ApiContext {
  client: Client;
  /** Lectures du ledger validé, par le port `Ledger` (même nœud que `client`). */
  ledger: Ledger;
  network: NetworkConfig;
  /** Wallets de démo : le serveur signe pour chaque acteur. Les seeds ne sortent jamais de l'API. */
  actors: Actors;
  store: FundStateStore;
  events: EventHub;
  operations: OperationQueue;
}

export function requireFund(context: ApiContext): FundState {
  const state = context.store.current;
  if (state === undefined) throw new HttpError(HTTP_NOT_FOUND, "Aucun fonds : POST /api/fund pour en créer un");
  return state;
}

export function networkId(context: ApiContext): number {
  const id = context.client.networkID;
  if (id === undefined) throw new Error("NetworkID du nœud inconnu : impossible de lier la preuve à la chaîne");
  return id;
}

/** Valeurs publiques attendues d'une preuve pour le fonds courant (fiche du fonds + PME de la démo). */
export function proofExpectations(context: ApiContext): ProofExpectations {
  const { manifest } = requireFund(context).fund;
  return {
    smeAccount: context.actors.sme.address,
    registry: manifest.registry,
    networkId: networkId(context),
    debtorsRoot: fromHex(manifest.debtorsRoot),
    vintage: BigInt(manifest.vintage),
  };
}
