// Tests de bout en bout : l'API du fonds et le front Vite, sur le réseau XRPL configuré par l'environnement.

import { defineConfig, devices } from "@playwright/test";

/** API_FUND_PORT : l'API des e2e peut tourner à côté d'une API déjà lancée sur le port par défaut. */
const API_PORT = process.env.API_FUND_PORT ?? "8788";
const API_URL = `http://127.0.0.1:${API_PORT}`;
const WEB_URL = "http://localhost:5173";
/** Fonds de démo durable (≈ 2 min sur l'AlphaNet quand il faut le créer, sinon réutilisé), puis démarrage de l'API. */
const API_STARTUP_MS = 10 * 60_000;
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
      // Pas de globalSetup : Playwright démarre les webServer avant lui, et l'API ne lit son état qu'au démarrage.
      command: "npm run demo:fund && npm run api:fund",
      url: `${API_URL}/api/debtors`,
      timeout: API_STARTUP_MS,
      reuseExistingServer,
    },
    {
      command: "npm run web",
      url: WEB_URL,
      env: { API_PORT },
      reuseExistingServer,
    },
  ],
});
