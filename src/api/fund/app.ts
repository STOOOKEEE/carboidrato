// Application Fastify du serveur du fonds : CORS limité au front, sérialisation des montants bigint, routes.

import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { clientWalletTxPorts, type WalletTxPorts } from "../../xrpl/preparedTx.js";
import type { ApiConfig } from "./config.js";
import type { ApiContext } from "./context.js";
import { makeErrorHandler } from "./errors.js";
import { registerAuditRoutes } from "./routes/auditRoutes.js";
import { registerAuthRoutes } from "./routes/authRoutes.js";
import { registerDebtorRoutes } from "./routes/debtorRoutes.js";
import { registerEventRoutes } from "./routes/eventRoutes.js";
import { registerFundRoutes } from "./routes/fundRoutes.js";
import { clientLenderPorts, registerLenderRoutes, type LenderPorts } from "./routes/lenderRoutes.js";
import { registerLoanRoutes } from "./routes/loanRoutes.js";
import { registerOnboardingRoutes } from "./routes/onboardingRoutes.js";
import { registerPublicBodyRoutes } from "./routes/publicBodyRoutes.js";
import { registerSmeRoutes } from "./routes/smeRoutes.js";
import { registerTxRoutes } from "./routes/txRoutes.js";
import { registerWalletAuthRoutes } from "./routes/walletAuthRoutes.js";
import { registerZkRoutes } from "./routes/zkRoutes.js";

/** Une facture attestée ou une preuve font quelques Ko. */
const BODY_LIMIT_BYTES = 64 * 1024;

/** Montants en unités RLUSD (bigint) → chaînes décimales, sans perte de précision. */
function serializeJson(payload: unknown): string {
  return JSON.stringify(payload, (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value));
}

/**
 * `ports` : soumissions signées (ordres des prêteurs, remboursements) ; `walletPorts` : transactions que signe le
 * wallet d'un utilisateur. Les deux sont remplacés par des faux dans les tests de routes.
 */
export async function buildApp(
  config: ApiConfig,
  context: ApiContext,
  ports: LenderPorts = clientLenderPorts(context.client),
  walletPorts: WalletTxPorts = clientWalletTxPorts(context.client),
): Promise<FastifyInstance> {
  // Un champ inattendu (ex. une donnée du témoin) est refusé en 400, pas retiré en silence.
  const app = Fastify({ bodyLimit: BODY_LIMIT_BYTES, ajv: { customOptions: { removeAdditional: false } } });
  await app.register(cors, { origin: config.corsOrigins });
  app.setReplySerializer(serializeJson);
  app.setErrorHandler(makeErrorHandler((hash) => context.events.transactionUrl(hash)));

  registerAuthRoutes(app, context);
  registerWalletAuthRoutes(app, context, walletPorts);
  registerOnboardingRoutes(app, context, ports.submit, walletPorts);
  registerFundRoutes(app, context);
  registerPublicBodyRoutes(app, context);
  registerLenderRoutes(app, context, ports, walletPorts);
  registerDebtorRoutes(app);
  registerZkRoutes(app, context);
  registerSmeRoutes(app, context, walletPorts);
  registerLoanRoutes(app, context, ports.submit, walletPorts);
  registerAuditRoutes(app, context);
  registerEventRoutes(app, context);
  registerTxRoutes(app, context);
  return app;
}
