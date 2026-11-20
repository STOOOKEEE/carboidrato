// Audit public du fonds courant depuis le ledger seul : résultat structuré (preuves, unicité, concentration).

import type { FastifyInstance } from "fastify";
import { auditFund } from "../../../audit/auditFund.js";
import { requireFund, type ApiContext } from "../context.js";

export function registerAuditRoutes(app: FastifyInstance, context: ApiContext): void {
  // Lecture seule : hors de la file des opérations, l'audit ne signe rien.
  app.get("/api/audit", async () => auditFund(context.client, requireFund(context).fund.cohort.vaultId));
}
