// Fonds : création (stablecoin, KYC, domaine, Vault + broker), état public, comptes des acteurs, souscription,
// rachat.

import type { FastifyInstance } from "fastify";
import { ACTOR_NAMES } from "../../../accounts/actors.js";
import { loadCohortTiming } from "../../../config/cohort.js";
import { redeemAll } from "../../../lending/redemption.js";
import { subscribe } from "../../../lending/subscription.js";
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
    const { result: fund, transactions } = await context.operations.run("fund.create", () =>
      setupFund(context.client, context.actors, timing),
    );
    const state = context.store.reset(fund);
    return reply.status(HTTP_CREATED).send({ fund: await fundView(context, state), timing, transactions });
  });

  app.get("/api/fund", async () => fundView(context, requireFund(context)));

  app.post("/api/investors/deposit", async () => {
    const state = requireFund(context);
    if (state.deposited) throw new HttpError(HTTP_CONFLICT, "Dépôts déjà effectués pour ce fonds");
    const { transactions } = await context.operations.run("investors.deposit", () =>
      subscribe(context.client, context.actors, state.fund),
    );
    context.store.update((current) => {
      current.deposited = true;
    });
    return { fund: await fundView(context, state), transactions };
  });

  app.post("/api/investors/redeem", async () => {
    const state = requireFund(context);
    if (state.redeemed) throw new HttpError(HTTP_CONFLICT, "Rachat déjà effectué pour ce fonds");
    const { transactions } = await context.operations.run("investors.redeem", () =>
      redeemAll(context.client, context.actors, state.fund),
    );
    context.store.update((current) => {
      current.redeemed = true;
    });
    return { fund: await fundView(context, state), transactions };
  });
}
