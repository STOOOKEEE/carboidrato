// Fonds : création (stablecoin, KYC, domaine, Vault + broker, souscription des investisseurs de démo et liquidités de
// Bari), état public, comptes des acteurs.

import type { FastifyInstance } from "fastify";
import { ACTOR_NAMES } from "../../../accounts/actors.js";
import { loadCohortTiming } from "../../../config/cohort.js";
import { BARI_EURC_RESERVE_EUR, BARI_SHARE_STOCK_EUR } from "../../../config/finance.js";
import { subscribe } from "../../../lending/subscription.js";
import { eurToUnits } from "../../../lib/amounts.js";
import { setupFund } from "../../../setup/fundSetup.js";
import { requireFund, type ApiContext } from "../context.js";
import { HttpError } from "../errors.js";
import { fundView } from "../fundView.js";
import { createFundSchema, type CreateFundBody } from "../schemas.js";

const HTTP_CONFLICT = 409;
const HTTP_CREATED = 201;

export function registerFundRoutes(app: FastifyInstance, context: ApiContext): void {
  app.get("/api/actors", async () =>
    ACTOR_NAMES.map((name) => ({
      name,
      address: context.actors[name].address,
      explorerUrl: `${context.network.explorerUrl}/accounts/${context.actors[name].address}`,
    })),
  );

  app.post<{ Body: CreateFundBody }>("/api/fund", { schema: createFundSchema }, async (request, reply) => {
    const { subscriptionWindowS, investmentPeriodS, replace = false } = request.body;
    if (context.store.current !== undefined && !replace) {
      throw new HttpError(HTTP_CONFLICT, "Un fonds existe déjà : passer { replace: true } pour en créer un nouveau", {
        vaultId: context.store.current.fund.cohort.vaultId,
      });
    }
    const defaults = loadCohortTiming();
    const timing = {
      subscriptionWindowS: subscriptionWindowS ?? defaults.subscriptionWindowS,
      investmentPeriodS: investmentPeriodS ?? defaults.investmentPeriodS,
    };
    // Comme `npm run demo:fund` : stock de parts et réserve EURc de Bari pour l'entrée et la sortie immédiates.
    const liquidity = { shareStock: eurToUnits(BARI_SHARE_STOCK_EUR), reserve: eurToUnits(BARI_EURC_RESERVE_EUR) };
    const { result: fund, transactions } = await context.operations.run("fund.create", async () => {
      const created = await setupFund(context.client, context.actors, timing, liquidity);
      await subscribe(context.client, context.actors, created, liquidity);
      return created;
    });
    const state = context.store.reset(fund);
    context.store.update((current) => {
      current.deposited = true;
    });
    return reply.status(HTTP_CREATED).send({ fund: await fundView(context, state), timing, transactions });
  });

  app.get("/api/fund", async () => fundView(context, requireFund(context)));
}
