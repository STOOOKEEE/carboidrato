// Espace prêteur : position et rendement, RLUSD de test, dépôt et retrait, natifs pendant la souscription et le rachat,
// immédiats par Bari (Batch atomique) pendant la période de prêt où le Vault fermé refuse. Compte géré : Bari signe et
// soumet. Wallet (Otsu) : Bari prépare l'ordre (et signe sa part du Batch), le wallet le signe, Bari soumet ce blob exact.

import type { FastifyInstance } from "fastify";
import { decode, encode, hashes, signMultiBatch, Wallet, type Client, type LedgerEntry, type SubmittableTransaction } from "xrpl";
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
import {
  buySharesFromBari,
  depositToVault,
  entryPayments,
  exitPayments,
  sellSharesToBari,
  vaultDeposit,
  vaultWithdraw,
  withdrawFromVault,
  type ShareTrade,
} from "../../../lending/lenderTrades.js";
import { formatRlusd, parseUnits, rlusdToUnits } from "../../../lib/amounts.js";
import { TENTH_BIPS_PER_PERCENT } from "../../../lib/rates.js";
import { allOrNothingBatch, clientBatchSubmitter, COSIGNER_SIGNATURES, type SubmitBatch } from "../../../xrpl/batch.js";
import {
  EXPIRED_RESULT,
  innerApplied,
  matchesPrepared,
  PreparedStore,
  SIGNING_WINDOW_LEDGERS,
  type WalletTxPorts,
} from "../../../xrpl/preparedTx.js";
import { stablecoinPayment, valueToUnits } from "../../../xrpl/stablecoin.js";
import { clientSubmitter, UnexpectedTxResult, type SubmitTx } from "../../../xrpl/submit.js";
import type {
  LenderFaucetResponse,
  LenderOrderResponse,
  LenderPosition,
  LenderSubmitRequest,
  LenderTradeLimit,
  LenderTradeRequest,
  LenderTradeResponse,
  LenderTradeRoute,
} from "../../contract.js";
import { requireRole, sessionUser } from "../auth.js";
import { requireFund, type ApiContext } from "../context.js";
import { HttpError } from "../errors.js";
import { phaseAt, type FundPhase } from "../fundView.js";
import { lenderTradeSchema, signedTxSchema } from "../schemas.js";
import type { FundState } from "../stateStore.js";

const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const HTTP_CONFLICT = 409;
const HTTP_UNPROCESSABLE = 422;
const FAUCET_RLUSD = 10_000;
/** NetworkID du mainnet : le faucet de RLUSD de test y est refusé. */
const MAINNET_NETWORK_ID = 0;
const SUCCESS = "tesSUCCESS";
const UNITS_PER_CENT = 10_000n;

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
type Action = "deposit" | "withdraw";

/** Vault, prêts, soldes du prêteur et liquidités de Bari, lus sur le ledger validé. */
interface Market {
  phase: FundPhase;
  price: SharePrice;
  yieldTenthBips: number;
  shares: bigint;
  rlusd: bigint;
  limits: ImmediateLimits;
}

/** Ordre contrôlé : natif (le Vault fixe ce qu'il rend), ou échange immédiat avec Bari au prix de la part. */
type Plan = { route: "native" } | { route: "immediate"; trade: ShareTrade };

/** Ordre préparé pour un wallet, en attente de sa signature. */
interface PreparedOrder {
  tx: SubmittableTransaction;
  action: Action;
  phase: FundPhase;
  plan: Plan;
  /** RLUSD (dépôt) ou parts (retrait) demandés. */
  requested: bigint;
  /** Soldes du prêteur avant l'ordre : le résultat du chemin natif se lit par différence. */
  before: Pick<Market, "shares" | "rlusd">;
  labels: string[];
  innerHashes: string[];
}

function managedWallet(user: Lender): Wallet {
  if (user.account === undefined) throw new HttpError(HTTP_CONFLICT, "This account has no XRPL account yet");
  return Wallet.fromSeed(user.account.seed);
}

/** Compte XRPL du prêteur : son wallet, ou le compte géré par Bari. */
function lenderAddress(user: Lender): string {
  return user.custody === "wallet" ? user.address : managedWallet(user).address;
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

function planDeposit(market: Market, amount: bigint): Plan {
  const route = ENTRY_ROUTES[market.phase];
  if (route === null) refuse("Deposits are closed: the fund is in its redemption phase");
  if (amount > market.rlusd) refuse(`Amount above your RLUSD balance (${market.rlusd} units)`);
  if (route === "native") return { route };
  if (amount > market.limits.maxEntryAmount) {
    refuse(`Amount above the immediate entry cap (${market.limits.maxEntryAmount} RLUSD units of Atlas's share stock)`);
  }
  const shares = entryShares(market.price, amount);
  if (shares === 0n) refuse("Amount too small to buy a share unit");
  return { route, trade: { amount, shares } };
}

function planWithdraw(market: Market, shares: bigint): Plan {
  const route = EXIT_ROUTES[market.phase];
  if (shares > market.shares) refuse(`Amount above your share balance (${market.shares} units)`);
  if (route === "native") return { route };
  if (shares > market.limits.maxExitShares) {
    refuse(`Amount above the immediate exit cap (${market.limits.maxExitShares} share units covered by Atlas's RLUSD reserve)`);
  }
  const amount = exitPayout(market.price, shares);
  if (amount === 0n) refuse("Amount too small to receive a RLUSD unit");
  return { route, trade: { amount, shares } };
}

const PLANS: Record<Action, (market: Market, requested: bigint) => Plan> = { deposit: planDeposit, withdraw: planWithdraw };

/** RLUSD et parts échangés une fois l'ordre validé : connus d'avance (immédiat) ou lus sur le ledger (natif). */
async function settledTrade(
  context: ApiContext,
  state: FundState,
  address: string,
  order: Pick<PreparedOrder, "action" | "plan" | "requested" | "before">,
): Promise<ShareTrade> {
  const { action, plan, requested, before } = order;
  if (plan.route === "immediate") return plan.trade;
  const { fund } = state;
  if (action === "deposit") {
    return { amount: requested, shares: (await context.ledger.mptBalance(fund.cohort.shareMptId, address)) - before.shares };
  }
  return { amount: (await context.ledger.stablecoinBalance(fund.stablecoin, address)) - before.rlusd, shares: requested };
}

function recordTrade(context: ApiContext, userId: string, action: Action, trade: ShareTrade): void {
  if (action === "deposit") context.users.recordPurchase(userId, { shares: trade.shares, cost: trade.amount });
  else context.users.recordSale(userId, trade.shares);
}

/** Libellés affichés dans le front, unités tronquées au centième. */
const centsFormat = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const shown = (units: bigint) => centsFormat.format(Number(units / UNITS_PER_CENT) / 100);

function orderLabels(action: Action, plan: Plan, requested: bigint): string[] {
  if (plan.route === "native") {
    return action === "deposit"
      ? [`Deposit ${shown(requested)} RLUSD into the fund's vault`]
      : [`Return ${shown(requested)} shares to the fund's vault`];
  }
  const { amount, shares } = plan.trade;
  return action === "deposit"
    ? [`Pay ${shown(amount)} RLUSD to Atlas`, `Receive ${shown(shares)} shares from Atlas`]
    : [`Sell ${shown(shares)} shares to Atlas`, `Receive ${shown(amount)} RLUSD from Atlas`];
}

export function registerLenderRoutes(app: FastifyInstance, context: ApiContext, ports: LenderPorts, walletPorts: WalletTxPorts): void {
  const preHandler = requireRole(context, "lender");
  // En mémoire : un redémarrage oblige seulement à recommencer l'ordre.
  const prepared = new PreparedStore<PreparedOrder>();

  /** Ordre du compte géré : Bari signe et soumet ; mêmes réponses qu'avant la connexion par wallet. */
  async function executeManaged(user: Lender, state: FundState, action: Action, requested: bigint) {
    const lender = managedWallet(user);
    const { fund } = state;
    const parties = { fund, bari: context.actors.bari, lender };
    return context.operations.run(`lender.${action}`, async () => {
      const market = await readMarket(context, state, lender.address);
      const plan = PLANS[action](market, requested);
      let hash: string;
      if (action === "deposit") {
        ({ hash } = plan.route === "native"
          ? await depositToVault(ports.submit, fund, lender, requested)
          : await buySharesFromBari(ports.submitBatch, parties, plan.trade));
      } else {
        ({ hash } = plan.route === "native"
          ? await withdrawFromVault(ports.submit, fund, lender, requested)
          : await sellSharesToBari(ports.submitBatch, parties, plan.trade));
      }
      const trade = await settledTrade(context, state, lender.address, { action, plan, requested, before: market });
      return { hash, route: plan.route, phase: market.phase, trade };
    });
  }

  /**
   * Ordre d'un wallet : la transaction complète (séquences, frais, échéance ≈ 5 min) ; pour un Batch, la transaction du
   * wallet et celle de Bari, Bari signant ses BatchSigners avant le wallet.
   */
  async function prepareForWallet(address: string, state: FundState, action: Action, requested: bigint) {
    const { fund } = state;
    const bari = context.actors.bari;
    return context.operations.run(`lender.${action}.prepare`, async () => {
      const market = await readMarket(context, state, address);
      const plan = PLANS[action](market, requested);
      const own = await walletPorts.accountState(address);
      const LastLedgerSequence = own.ledgerIndex + SIGNING_WINDOW_LEDGERS;
      let tx: SubmittableTransaction;
      if (plan.route === "native") {
        const order = action === "deposit" ? vaultDeposit(fund, address, requested) : vaultWithdraw(fund, address, requested);
        tx = await walletPorts.autofill({ ...order, Sequence: own.sequence, LastLedgerSequence });
      } else {
        const payments = (action === "deposit" ? entryPayments : exitPayments)(fund, { bari: bari.address, lender: address }, plan.trade);
        const { sequence: bariSequence } = await walletPorts.accountState(bari.address);
        // Le Batch externe consomme la séquence du wallet, sa transaction interne la suivante.
        const inner = payments.map(({ tx: payment }) => ({ ...payment, Sequence: payment.Account === address ? own.sequence + 1 : bariSequence }));
        const batch = { ...allOrNothingBatch(address, inner), Sequence: own.sequence, LastLedgerSequence };
        const cosigned = await walletPorts.autofill(batch, COSIGNER_SIGNATURES);
        signMultiBatch(bari, cosigned);
        tx = cosigned;
      }
      const innerHashes =
        tx.TransactionType === "Batch" ? tx.RawTransactions.map(({ RawTransaction }) => hashes.hashSignedTx(RawTransaction)) : [];
      const order: PreparedOrder = {
        tx,
        action,
        phase: market.phase,
        plan,
        requested,
        before: market,
        labels: orderLabels(action, plan, requested),
        innerHashes,
      };
      return order;
    });
  }

  async function placeOrder(user: Lender, action: Action, requested: bigint): Promise<LenderOrderResponse> {
    const state = requireFund(context);
    if (user.custody === "wallet") {
      const { result: order } = await prepareForWallet(user.address, state, action, requested);
      prepared.set(user.id, order);
      return { status: "sign", tx: decode(encode(order.tx)), labels: order.labels, transactions: [] };
    }
    const { result, transactions } = await executeManaged(user, state, action, requested);
    recordTrade(context, user.id, action, result.trade);
    const { hash, route, phase, trade } = result;
    return { hash, route, phase, amount: trade.amount.toString(), shares: trade.shares.toString(), transactions };
  }

  app.get("/api/lender/position", { preHandler }, async (request): Promise<LenderPosition> => {
    const user = sessionUser(request, "lender");
    const market = await readMarket(context, requireFund(context), lenderAddress(user));
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
    const lender = lenderAddress(sessionUser(request, "lender"));
    const { fund } = requireFund(context);
    const issuer = context.actors.stable_issuer;
    if (fund.stablecoin.issuer !== issuer.address) {
      throw new HttpError(HTTP_FORBIDDEN, "Test RLUSD are only available from Atlas's test issuer");
    }
    const amount = rlusdToUnits(FAUCET_RLUSD);
    const { result, transactions } = await context.operations.run("lender.faucet", () =>
      ports.submit(
        stablecoinPayment(fund.stablecoin, issuer.address, lender, amount),
        issuer,
        `Payment RLUSD de test → prêteur (${formatRlusd(amount, 2)})`,
      ),
    );
    return { hash: result.hash, amount: amount.toString(), transactions };
  });

  app.post<{ Body: LenderTradeRequest }>(
    "/api/lender/deposit",
    { preHandler, schema: lenderTradeSchema },
    (request) => placeOrder(sessionUser(request, "lender"), "deposit", BigInt(request.body.amount)),
  );

  app.post<{ Body: LenderTradeRequest }>(
    "/api/lender/withdraw",
    { preHandler, schema: lenderTradeSchema },
    (request) => placeOrder(sessionUser(request, "lender"), "withdraw", BigInt(request.body.amount)),
  );

  app.post<{ Body: LenderSubmitRequest }>(
    "/api/lender/submit",
    { preHandler, schema: signedTxSchema },
    async (request): Promise<LenderTradeResponse> => {
      const user = sessionUser(request, "lender");
      const pending = prepared.get(user.id);
      if (pending === undefined || user.custody !== "wallet") {
        throw new HttpError(HTTP_CONFLICT, "Nothing is waiting for your signature. Start again.");
      }
      const txBlob = request.body.tx_blob;
      if (!matchesPrepared(pending.tx, txBlob)) {
        throw new HttpError(HTTP_BAD_REQUEST, "This is not the transaction Atlas prepared. Start again.");
      }
      // Oublié avant la soumission : la séquence est consommée quoi qu'il arrive, l'ordre ne se resoumet pas.
      prepared.delete(user.id);

      const hash = hashes.hashSignedTx(txBlob);
      const label = `${pending.tx.TransactionType} prêteur signé dans Otsu (${pending.action})`;
      const state = requireFund(context);
      const { result: trade, transactions } = await context.operations.run(`lender.${pending.action}`, async () => {
        await walletPorts.submitSigned(txBlob, hash, label).catch((error: unknown) => {
          if (error instanceof UnexpectedTxResult && error.result.startsWith(EXPIRED_RESULT)) {
            throw new HttpError(HTTP_CONFLICT, "This request expired before it reached the ledger. Start again.");
          }
          throw error;
        });
        if (pending.innerHashes.length > 0 && !(await innerApplied(context.ledger, pending.innerHashes))) {
          throw new HttpError(
            HTTP_CONFLICT,
            "Nothing moved: the trade could not go through as prepared, only the network fee was charged. Start again.",
          );
        }
        return settledTrade(context, state, user.address, pending);
      });
      recordTrade(context, user.id, pending.action, trade);
      const inner = pending.innerHashes.map((innerHash, index) => ({ label: pending.labels[index] ?? label, hash: innerHash, result: SUCCESS }));
      return {
        hash,
        route: pending.plan.route,
        phase: pending.phase,
        amount: trade.amount.toString(),
        shares: trade.shares.toString(),
        transactions: [...transactions, ...inner],
      };
    },
  );
}
