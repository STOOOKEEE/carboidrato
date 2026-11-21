// Espace prêteur : position et rendement, RLUSD de test, dépôt et retrait par le compte géré, natifs pendant la
// souscription et le rachat, immédiats par Bari (Batch atomique) pendant la période de prêt où le Vault fermé refuse.

import type { FastifyInstance } from "fastify";
import { Wallet, type Client, type LedgerEntry } from "xrpl";
import type { UserRecord } from "../../../accounts/userStore.js";
import {
  IMMEDIATE_EXIT_DISCOUNT_PERCENT,
  entryShares,
  exitPayout,
  immediateLimits,
  perDisplayShare,
  positionValue,
  sharePrice,
  variableYieldTenthBips,
  type ImmediateLimits,
  type SharePrice,
} from "../../../fund/sharePrice.js";
import { buySharesFromBari, depositToVault, sellSharesToBari, withdrawFromVault } from "../../../lending/lenderTrades.js";
import { formatRlusd, parseUnits, rlusdToUnits } from "../../../lib/amounts.js";
import { TENTH_BIPS_PER_PERCENT } from "../../../lib/rates.js";
import { clientBatchSubmitter, type SubmitBatch } from "../../../xrpl/batch.js";
import { stablecoinPayment, valueToUnits } from "../../../xrpl/stablecoin.js";
import { clientSubmitter, type SubmitTx } from "../../../xrpl/submit.js";
import type {
  LenderFaucetResponse,
  LenderPosition,
  LenderTradeLimit,
  LenderTradeRequest,
  LenderTradeResponse,
  LenderTradeRoute,
} from "../../contract.js";
import { requireRole, sessionUser } from "../auth.js";
import { requireFund, type ApiContext } from "../context.js";
import { HttpError } from "../errors.js";
import { phaseAt, type FundPhase } from "../fundView.js";
import { lenderTradeSchema } from "../schemas.js";
import type { FundState } from "../stateStore.js";

const HTTP_FORBIDDEN = 403;
const HTTP_CONFLICT = 409;
const HTTP_UNPROCESSABLE = 422;
const FAUCET_RLUSD = 10_000;
/** NetworkID du mainnet : le faucet de RLUSD de test y est refusé. */
const MAINNET_NETWORK_ID = 0;

const ENTRY_ROUTES: Record<FundPhase, LenderTradeRoute | null> = {
  subscription: "native",
  investment: "immediate",
  redemption: null,
};
const EXIT_ROUTES: Record<FundPhase, LenderTradeRoute> = {
  subscription: "native",
  investment: "immediate",
  redemption: "native",
};

/** Soumissions signées des ordres des prêteurs : le nœud en production, des faux dans les tests. */
export interface LenderPorts {
  submit: SubmitTx;
  submitBatch: SubmitBatch;
}

export function clientLenderPorts(client: Client): LenderPorts {
  return { submit: clientSubmitter(client), submitBatch: clientBatchSubmitter(client) };
}

type Lender = Extract<UserRecord, { role: "lender" }>;

/** Vault, prêts, soldes du prêteur et liquidités de Bari, lus sur le ledger validé. */
interface Market {
  phase: FundPhase;
  price: SharePrice;
  yieldTenthBips: number;
  shares: bigint;
  rlusd: bigint;
  limits: ImmediateLimits;
}

function lenderWallet(user: Lender): Wallet {
  if (user.account === undefined) throw new HttpError(HTTP_CONFLICT, "This account has no XRPL account yet");
  return Wallet.fromSeed(user.account.seed);
}

async function activeLoans(context: ApiContext, broker: LedgerEntry.LoanBroker) {
  const entries = await context.ledger.accountObjects(broker.Account, "loan");
  return entries
    .filter((entry): entry is LedgerEntry.Loan => entry.LedgerEntryType === "Loan" && entry.LoanBrokerID === broker.index)
    .map((loan) => ({ principalOutstanding: valueToUnits(loan.PrincipalOutstanding), interestRate: loan.InterestRate ?? 0 }));
}

async function readMarket(context: ApiContext, state: FundState, address: string): Promise<Market> {
  const { ledger } = context;
  const { fund } = state;
  const bari = context.actors.bari.address;
  const { shareMptId } = fund.cohort;
  const [time, vault, issuance, broker, shares, rlusd, shareStock, reserve] = await Promise.all([
    ledger.closeTime(),
    ledger.vault(fund.cohort.vaultId),
    ledger.mptIssuance(shareMptId),
    ledger.loanBroker(fund.brokerId),
    ledger.mptBalance(shareMptId, address),
    ledger.stablecoinBalance(fund.stablecoin, address),
    ledger.mptBalance(shareMptId, bari),
    ledger.stablecoinBalance(fund.stablecoin, bari),
  ]);
  if (issuance === undefined) throw new Error(`Émission des parts introuvable : ${shareMptId}`);
  const assetsTotal = valueToUnits(vault.AssetsTotal);
  const price = sharePrice({
    assetsTotal,
    lossUnrealized: valueToUnits(vault.LossUnrealized),
    sharesOutstanding: parseUnits(issuance.OutstandingAmount),
  });
  const phase = phaseAt(time, state);
  return {
    phase,
    price,
    yieldTenthBips: variableYieldTenthBips(await activeLoans(context, broker), broker.ManagementFeeRate ?? 0, assetsTotal),
    shares,
    rlusd,
    limits: immediateLimits(price, { shareStock, reserve }),
  };
}

function entryLimit({ phase, rlusd, limits }: Market): LenderTradeLimit {
  const route = ENTRY_ROUTES[phase];
  if (route === null) return { route, max: "0" };
  if (route === "native") return { route, max: rlusd.toString() };
  const max = rlusd < limits.maxEntryAmount ? rlusd : limits.maxEntryAmount;
  return { route, max: max.toString(), bariCap: limits.maxEntryAmount.toString() };
}

function exitLimit({ phase, shares, limits }: Market): LenderTradeLimit {
  const route = EXIT_ROUTES[phase];
  if (route === "native") return { route, max: shares.toString() };
  const max = shares < limits.maxExitShares ? shares : limits.maxExitShares;
  return { route, max: max.toString(), bariCap: limits.maxExitShares.toString() };
}

function refuse(message: string): never {
  throw new HttpError(HTTP_UNPROCESSABLE, message);
}

export function registerLenderRoutes(app: FastifyInstance, context: ApiContext, ports: LenderPorts): void {
  const preHandler = requireRole(context, "lender");

  app.get("/api/lender/position", { preHandler }, async (request): Promise<LenderPosition> => {
    const user = sessionUser(request, "lender");
    const market = await readMarket(context, requireFund(context), lenderWallet(user).address);
    const basis = context.users.costBasis(user.id);
    const value = positionValue(market.price, market.shares);
    return {
      phase: market.phase,
      shares: market.shares.toString(),
      value: value.toString(),
      costBasis: basis.cost.toString(),
      ...(basis.shares === 0n ? {} : { averageCost: perDisplayShare(basis.cost, basis.shares).toString() }),
      gain: (value - basis.cost).toString(),
      sharePrice: perDisplayShare(market.price.assets, market.price.shares).toString(),
      variableYieldPercent: market.yieldTenthBips / TENTH_BIPS_PER_PERCENT,
      rlusdBalance: market.rlusd.toString(),
      entry: entryLimit(market),
      exit: exitLimit(market),
      immediateExitDiscountPercent: IMMEDIATE_EXIT_DISCOUNT_PERCENT,
    };
  });

  app.post("/api/lender/faucet", { preHandler }, async (request): Promise<LenderFaucetResponse> => {
    const networkId = context.ledger.networkId();
    if (networkId === undefined || networkId === MAINNET_NETWORK_ID) {
      throw new HttpError(HTTP_FORBIDDEN, "Test RLUSD are only available on a test network");
    }
    const lender = lenderWallet(sessionUser(request, "lender"));
    const { fund } = requireFund(context);
    const issuer = context.actors.stable_issuer;
    if (fund.stablecoin.issuer !== issuer.address) {
      throw new HttpError(HTTP_FORBIDDEN, "Test RLUSD are only available from Bari's test issuer");
    }
    const amount = rlusdToUnits(FAUCET_RLUSD);
    const { result, transactions } = await context.operations.run("lender.faucet", () =>
      ports.submit(
        stablecoinPayment(fund.stablecoin, issuer.address, lender.address, amount),
        issuer,
        `Payment RLUSD de test → prêteur (${formatRlusd(amount, 2)})`,
      ),
    );
    return { hash: result.hash, amount: amount.toString(), transactions };
  });

  app.post<{ Body: LenderTradeRequest }>(
    "/api/lender/deposit",
    { preHandler, schema: lenderTradeSchema },
    async (request): Promise<LenderTradeResponse> => {
      const user = sessionUser(request, "lender");
      const lender = lenderWallet(user);
      const amount = BigInt(request.body.amount);
      const state = requireFund(context);
      const { fund } = state;
      const { result, transactions } = await context.operations.run("lender.deposit", async () => {
        const market = await readMarket(context, state, lender.address);
        const route = ENTRY_ROUTES[market.phase];
        if (route === null) refuse("Deposits are closed: the fund is in its redemption phase");
        if (amount > market.rlusd) refuse(`Amount above your RLUSD balance (${market.rlusd} units)`);
        if (route === "native") {
          const { hash } = await depositToVault(ports.submit, fund, lender, amount);
          const shares = (await context.ledger.mptBalance(fund.cohort.shareMptId, lender.address)) - market.shares;
          return { hash, route, phase: market.phase, shares };
        }
        if (amount > market.limits.maxEntryAmount) {
          refuse(`Amount above the immediate entry cap (${market.limits.maxEntryAmount} RLUSD units of Bari's share stock)`);
        }
        const shares = entryShares(market.price, amount);
        if (shares === 0n) refuse("Amount too small to buy a share unit");
        const { hash } = await buySharesFromBari(ports.submitBatch, { fund, bari: context.actors.bari, lender }, { amount, shares });
        return { hash, route, phase: market.phase, shares };
      });
      context.users.recordPurchase(user.id, { shares: result.shares, cost: amount });
      return { ...result, amount: amount.toString(), shares: result.shares.toString(), transactions };
    },
  );

  app.post<{ Body: LenderTradeRequest }>(
    "/api/lender/withdraw",
    { preHandler, schema: lenderTradeSchema },
    async (request): Promise<LenderTradeResponse> => {
      const user = sessionUser(request, "lender");
      const lender = lenderWallet(user);
      const shares = BigInt(request.body.amount);
      const state = requireFund(context);
      const { fund } = state;
      const { result, transactions } = await context.operations.run("lender.withdraw", async () => {
        const market = await readMarket(context, state, lender.address);
        const route = EXIT_ROUTES[market.phase];
        if (shares > market.shares) refuse(`Amount above your share balance (${market.shares} units)`);
        if (route === "native") {
          const { hash } = await withdrawFromVault(ports.submit, fund, lender, shares);
          const amount = (await context.ledger.stablecoinBalance(fund.stablecoin, lender.address)) - market.rlusd;
          return { hash, route, phase: market.phase, amount };
        }
        if (shares > market.limits.maxExitShares) {
          refuse(`Amount above the immediate exit cap (${market.limits.maxExitShares} share units covered by Bari's RLUSD reserve)`);
        }
        const amount = exitPayout(market.price, shares);
        if (amount === 0n) refuse("Amount too small to receive a RLUSD unit");
        const { hash } = await sellSharesToBari(ports.submitBatch, { fund, bari: context.actors.bari, lender }, { amount, shares });
        return { hash, route, phase: market.phase, amount };
      });
      context.users.recordSale(user.id, shares);
      return { ...result, amount: result.amount.toString(), shares: shares.toString(), transactions };
    },
  );
}
