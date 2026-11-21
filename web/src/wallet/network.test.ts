// Réseau du wallet : réseaux prédéfinis d'Otsu comparés par URL, réseau ajouté à la main non vérifiable.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { addNetworkSteps, checkNetwork } from "./network";

const devnet = { networkId: 2, wsUrl: "wss://s.devnet.rippletest.net:51233/" };
const alphanet = { networkId: 1000, wsUrl: "wss://node.example" };

describe("checkNetwork", () => {
  test("réseau prédéfini d'Otsu à la même URL que l'API → match", () => {
    assert.deepEqual(checkNetwork("devnet", devnet), { kind: "match" });
  });

  test("autre réseau prédéfini (ou réseau EVM) → mismatch", () => {
    assert.deepEqual(checkNetwork("testnet", devnet), { kind: "mismatch", walletNetwork: "testnet" });
    assert.deepEqual(checkNetwork("alphanet", alphanet), { kind: "mismatch", walletNetwork: "alphanet" });
    assert.deepEqual(checkNetwork("evm-testnet", devnet), { kind: "mismatch", walletNetwork: "evm-testnet" });
  });

  test("réseau ajouté à la main → custom", () => {
    assert.deepEqual(checkNetwork("custom-1763700000000", alphanet), { kind: "custom" });
  });
});

test("addNetworkSteps : chemin dans Otsu puis l'URL du nœud", () => {
  assert.equal(addNetworkSteps("wss://node.example"), "Otsu → Settings → Networks → Add custom network → wss://node.example");
});
