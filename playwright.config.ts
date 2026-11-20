// Tests de bout en bout : l'API du fonds et le front Vite, sur le réseau XRPL configuré par l'environnement.

import { defineConfig, devices } from "@playwright/test";

const API_URL = "http://127.0.0.1:8788";
const WEB_URL = "http://localhost:5173";
/** Connexion au nœud et création des comptes de démo au premier lancement. */
const API_STARTUP_MS = 180_000;
/** Un parcours on-chain attend plusieurs ledgers (3 s sur l'AlphaNet, ~4 s sur devnet). */
const TEST_TIMEOUT_MS = 5 * 60_000;
const reuseExistingServer = process.env.CI === undefined;

export default defineConfig({
  testDir: "web/e2e",
  timeout: TEST_TIMEOUT_MS,
  // Un seul fonds partagé sur le ledger : les tests ne tournent pas en parallèle.
  workers: 1,
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: WEB_URL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npm run api:fund",
      url: `${API_URL}/api/debtors`,
      timeout: API_STARTUP_MS,
      reuseExistingServer,
    },
    {
      command: "npm run web",
      url: WEB_URL,
      env: { API_PORT: "8788" },
      reuseExistingServer,
    },
  ],
});
