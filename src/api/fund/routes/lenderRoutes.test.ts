// Espace prêteur : position lue sur un faux ledger, chemin natif ou immédiat selon la phase, plafonds de Bari, garde de rôle.

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { Wallet, type LedgerEntry, type SubmittableTransaction } from "xrpl";
import type { Fund } from "../../../fund/fund.js";
import { exitPayout, immediateLimits } from "../../../fund/sharePrice.js";
import { FakeLedger } from "../../../xrpl/fakeLedger.js";
import type { PendingInner } from "../../../xrpl/batch.js";
import type { TxOutcome } from "../../../xrpl/submit.js";
import type { LenderFaucetResponse, LenderPosition, LenderTradeResponse } from "../../contract.js";
import { buildApp } from "../app.js";
import { fakeApiConfig, fakeContext } from "../fakeContext.js";

const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_UNPROCESSABLE = 422;
const PASSWORD = "correct horse battery";
const EUR = 1_000_000n;

const ASSET_ID = "0A".repeat(24);
const SHARE_ID = "0B".repeat(24);
const VAULT_ID = "0C".repeat(32);
const BROKER_ID = "0D".repeat(32);
const TX_HASH = "EE".repeat(32);
const SUBSCRIPTION_END = 1_000;
const REDEMPTION_START = 2_000;
const PHASE_TIME = { subscription: 500, investment: 1_500, redemption: 2_500 } as const;

const ledger = new FakeLedger(1000);
const brokerAccount = Wallet.generate().address;
const managedWallets = new Map<string, Wallet>();
const sent: { tx: SubmittableTransaction; signer: string }[] = [];
const batches: { submitter: string; cosigner: string; inner: readonly PendingInner[]; label: string }[] = [];
const outcome: TxOutcome = { hash: TX_HASH, result: "tesSUCCESS", meta: { AffectedNodes: [], TransactionIndex: 0, TransactionResult: "tesSUCCESS" } };

const context = fakeContext({
  ledger,
  provisionAccount: async ({ role }) => {
    const wallet = Wallet.generate();
    managedWallets.set(role, wallet);
    return { address: wallet.address, seed: wallet.seed ?? "" };
  },
});
const { bari, stable_issuer: stableIssuer } = context.actors;
const fund = {
  assetId: ASSET_ID,
  domainId: "0E".repeat(32),
  brokerId: BROKER_ID,
  cohort: { vaultId: VAULT_ID, shareMptId: SHARE_ID, subscriptionDate: SUBSCRIPTION_END, redemptionDate: REDEMPTION_START },
  manifest: { debtorsRoot: "0F".repeat(32), vintage: 2026, registry: context.actors.bari_registry.address },
} satisfies Fund;

let app: FastifyInstance;
const sessions = { lender: "", business: "" };
const lender = () => {
  const wallet = managedWallets.get("lender");
  if (wallet === undefined) throw new Error("prêteur non inscrit");
  return wallet;
};

/** Faux nœud : un VaultDeposit / VaultWithdraw au pair déplace les soldes, comme le ferait le ledger. */
async function fakeSubmit(tx: SubmittableTransaction, wallet: Wallet): Promise<TxOutcome> {
  sent.push({ tx, signer: wallet.address });
  if ((tx.TransactionType === "VaultDeposit" || tx.TransactionType === "VaultWithdraw") && typeof tx.Amount === "object") {
    const amount = BigInt(tx.Amount.value);
    const sign = tx.TransactionType === "VaultDeposit" ? 1n : -1n;
    const [shares, eurc] = await Promise.all([ledger.mptBalance(SHARE_ID, tx.Account), ledger.mptBalance(ASSET_ID, tx.Account)]);
    ledger.putMptBalance(SHARE_ID, tx.Account, shares + sign * amount);
    ledger.putMptBalance(ASSET_ID, tx.Account, eurc - sign * amount);
  }
  return outcome;
}

function putVault(assetsTotal: bigint, lossUnrealized: bigint, sharesOutstanding: bigint): void {
  ledger.putVault({
    LedgerEntryType: "Vault",
    LedgerIndex: VAULT_ID,
    index: VAULT_ID,
    Flags: 0,
    Sequence: 1,
    OwnerNode: "0",
    Owner: bari.address,
    Account: Wallet.generate().address,
    Asset: { mpt_issuance_id: ASSET_ID },
    AssetsTotal: assetsTotal.toString(),
    AssetsAvailable: assetsTotal.toString(),
    LossUnrealized: lossUnrealized.toString(),
    ShareMPTID: SHARE_ID,
    WithdrawalPolicy: 1,
    PreviousTxnID: TX_HASH,
    PreviousTxnLgrSeq: 1,
  });
  ledger.putMptIssuance(SHARE_ID, {
    LedgerEntryType: "MPTokenIssuance",
    index: SHARE_ID,
    Flags: 0,
    Issuer: bari.address,
    Sequence: 1,
    OutstandingAmount: sharesOutstanding.toString(),
    OwnerNode: "0",
    PreviousTxnID: TX_HASH,
    PreviousTxnLgrSeq: 1,
  });
}

const activeLoan: LedgerEntry.Loan = {
  LedgerEntryType: "Loan",
  index: "1A".repeat(32),
  Flags: 0,
  LoanSequence: 1,
  OwnerNode: "0",
  LoanBrokerNode: "0",
  LoanBrokerID: BROKER_ID,
  Borrower: Wallet.generate().address,
  InterestRate: 6_000,
  StartDate: 0,
  PaymentInterval: 60,
  GracePeriod: 60,
  NextPaymentDueDate: 3_000,
  PaymentRemaining: 1,
  TotalValueOutstanding: "9100000000",
  PrincipalOutstanding: (9_000n * EUR).toString(),
  PeriodicPayment: "9100000000",
  PreviousTxnID: TX_HASH,
  PreviousTxnLgrSeq: 1,
};

/** Fonds à 1,02 € la part : 103 000 € d'actifs, 1 000 € de perte latente, 100 000 parts affichées. */
function resetMarket(phase: keyof typeof PHASE_TIME, bariReserve = 5_000n * EUR): void {
  sent.length = 0;
  batches.length = 0;
  ledger.setCloseTime(PHASE_TIME[phase]);
  putVault(103_000n * EUR, 1_000n * EUR, 100_000n * EUR);
  ledger.putMptBalance(ASSET_ID, lender().address, 20_000n * EUR);
  ledger.putMptBalance(SHARE_ID, lender().address, 1_000n * EUR);
  ledger.putMptBalance(SHARE_ID, bari.address, 10_000n * EUR);
  ledger.putMptBalance(ASSET_ID, bari.address, bariReserve);
}

async function signup(body: object): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/auth/signup", payload: body });
  assert.equal(response.statusCode, 201, response.body);
  return String(response.headers["set-cookie"]).split(";")[0];
}

const get = (url: string, cookie?: string) => app.inject({ method: "GET", url, headers: cookie === undefined ? {} : { cookie } });
const post = (url: string, payload: object, cookie?: string) =>
  app.inject({ method: "POST", url, payload, headers: cookie === undefined ? {} : { cookie } });

before(async () => {
  app = await buildApp(fakeApiConfig, context, {
    submit: fakeSubmit,
    submitBatch: async (submitter, cosigner, inner, label) => {
      batches.push({ submitter: submitter.address, cosigner: cosigner.address, inner, label });
      return outcome;
    },
  });
  await app.ready();
  context.store.reset(fund);
  ledger.putLoanBroker({
    LedgerEntryType: "LoanBroker",
    index: BROKER_ID,
    Flags: 0,
    Sequence: 1,
    LoanSequence: 2,
    OwnerNode: "0",
    VaultNode: "0",
    VaultID: VAULT_ID,
    Account: brokerAccount,
    Owner: bari.address,
    ManagementFeeRate: 1_000,
    DebtMaximum: "0",
    PreviousTxnID: TX_HASH,
    PreviousTxnLgrSeq: 1,
  });
  ledger.putAccountObject(brokerAccount, "loan", activeLoan);
  ledger.putAccountObject(brokerAccount, "loan", { ...activeLoan, index: "1B".repeat(32), PrincipalOutstanding: "0" });
  sessions.lender = await signup({
    email: "alice@example.com",
    password: PASSWORD,
    role: "lender",
    profile: { name: "Alice Rossi", country: "IT", riskAcknowledged: true },
  });
  sessions.business = await signup({
    email: "marco@costruzioni.it",
    password: PASSWORD,
    role: "business",
    profile: { company: "Marco Costruzioni S.r.l.", vatNumber: "IT01234567890" },
  });
});

after(() => app.close());

describe("garde de rôle", () => {
  const routes = [
    ["GET", "/api/lender/position"],
    ["POST", "/api/lender/faucet"],
    ["POST", "/api/lender/deposit"],
    ["POST", "/api/lender/withdraw"],
  ] as const;

  test("sans session → 401 ; entreprise → 403", async () => {
    for (const [method, url] of routes) {
      const payload = method === "POST" ? { amount: "1" } : undefined;
      assert.equal((await app.inject({ method, url, payload })).statusCode, HTTP_UNAUTHORIZED, url);
      const forbidden = await app.inject({ method, url, payload, headers: { cookie: sessions.business } });
      assert.equal(forbidden.statusCode, HTTP_FORBIDDEN, url);
    }
  });

  test("les anciennes routes des investisseurs de démo n'existent plus", async () => {
    for (const action of ["deposit", "redeem"]) {
      const url = ["", "api", "investors", action].join("/");
      assert.equal((await post(url, {})).statusCode, HTTP_NOT_FOUND);
    }
  });
});

describe("GET /api/lender/position", () => {
  beforeEach(() => resetMarket("investment"));

  test("parts, valeur au prix de la part, rendement variable, plafonds de Bari", async () => {
    const response = await get("/api/lender/position", sessions.lender);
    assert.equal(response.statusCode, HTTP_OK, response.body);
    const { maxExitShares } = immediateLimits({ assets: 102_000n * EUR, shares: 100_000n * EUR }, { shareStock: 0n, reserve: 5_000n * EUR });
    assert.deepEqual(response.json<LenderPosition>(), {
      phase: "investment",
      shares: (1_000n * EUR).toString(),
      value: (1_020n * EUR).toString(),
      costBasis: "0",
      gain: (1_020n * EUR).toString(),
      sharePrice: "1020000",
      // 9 000 € à 6 % × (1 − 1 %) / 103 000 € d'actifs ; le prêt soldé ne compte pas.
      variableYieldPercent: 0.519,
      eurcBalance: (20_000n * EUR).toString(),
      entry: { route: "immediate", max: (10_200n * EUR).toString(), bariCap: (10_200n * EUR).toString() },
      exit: { route: "immediate", max: (1_000n * EUR).toString(), bariCap: maxExitShares.toString() },
      immediateExitDiscountPercent: 0.5,
    });
  });

  test("pendant la souscription : chemin natif, plafond = solde du prêteur", async () => {
    resetMarket("subscription");
    const position = (await get("/api/lender/position", sessions.lender)).json<LenderPosition>();
    assert.equal(position.phase, "subscription");
    assert.deepEqual(position.entry, { route: "native", max: (20_000n * EUR).toString() });
    assert.deepEqual(position.exit, { route: "native", max: (1_000n * EUR).toString() });
  });

  test("pendant le rachat : dépôt fermé, retrait natif", async () => {
    resetMarket("redemption");
    const position = (await get("/api/lender/position", sessions.lender)).json<LenderPosition>();
    assert.deepEqual(position.entry, { route: null, max: "0" });
    assert.equal(position.exit.route, "native");
  });
});

describe("POST /api/lender/deposit", () => {
  test("souscription : VaultDeposit natif signé par le compte géré, prix de revient suivi", async () => {
    resetMarket("subscription");
    // Vault au pair pendant la souscription.
    putVault(100_000n * EUR, 0n, 100_000n * EUR);
    const response = await post("/api/lender/deposit", { amount: (2_000n * EUR).toString() }, sessions.lender);
    assert.equal(response.statusCode, HTTP_OK, response.body);
    const body = response.json<LenderTradeResponse>();
    assert.equal(body.route, "native");
    assert.equal(body.hash, TX_HASH);
    assert.equal(body.shares, (2_000n * EUR).toString());
    assert.deepEqual(body.transactions, []);
    assert.deepEqual(
      sent.map(({ tx, signer }) => [tx.TransactionType, signer]),
      [["VaultDeposit", lender().address]],
    );
    assert.equal(batches.length, 0);
    const position = (await get("/api/lender/position", sessions.lender)).json<LenderPosition>();
    assert.equal(position.costBasis, (2_000n * EUR).toString());
    assert.equal(position.averageCost, "1000000");
  });

  test("période de prêt : Batch de deux Payment (EURc → Bari, parts de Bari → prêteur) au prix de la part", async () => {
    resetMarket("investment");
    const response = await post("/api/lender/deposit", { amount: (1_020n * EUR).toString() }, sessions.lender);
    assert.equal(response.statusCode, HTTP_OK, response.body);
    const body = response.json<LenderTradeResponse>();
    assert.deepEqual([body.route, body.amount, body.shares], ["immediate", (1_020n * EUR).toString(), (1_000n * EUR).toString()]);
    assert.equal(sent.length, 0);
    assert.equal(batches.length, 1);
    const [batch] = batches;
    assert.deepEqual([batch.submitter, batch.cosigner], [bari.address, lender().address]);
    assert.deepEqual(
      batch.inner.map(({ tx }) => (tx.TransactionType === "Payment" ? [tx.Account, tx.Destination, tx.Amount] : tx.TransactionType)),
      [
        [lender().address, bari.address, { mpt_issuance_id: ASSET_ID, value: (1_020n * EUR).toString() }],
        [bari.address, lender().address, { mpt_issuance_id: SHARE_ID, value: (1_000n * EUR).toString() }],
      ],
    );
  });

  test("au-delà du stock de parts de Bari → 422, rien n'est soumis", async () => {
    resetMarket("investment");
    const response = await post("/api/lender/deposit", { amount: (10_201n * EUR).toString() }, sessions.lender);
    assert.equal(response.statusCode, HTTP_UNPROCESSABLE);
    assert.match(response.json<{ error: string }>().error, /immediate entry cap/);
    assert.equal(batches.length + sent.length, 0);
  });

  test("au-delà du solde EURc → 422", async () => {
    resetMarket("subscription");
    const response = await post("/api/lender/deposit", { amount: (20_001n * EUR).toString() }, sessions.lender);
    assert.equal(response.statusCode, HTTP_UNPROCESSABLE);
    assert.match(response.json<{ error: string }>().error, /EURc balance/);
    assert.equal(sent.length, 0);
  });

  test("pendant le rachat → 422, montant invalide → 400", async () => {
    resetMarket("redemption");
    const closed = await post("/api/lender/deposit", { amount: EUR.toString() }, sessions.lender);
    assert.equal(closed.statusCode, HTTP_UNPROCESSABLE);
    assert.equal((await post("/api/lender/deposit", { amount: "-5" }, sessions.lender)).statusCode, 400);
    assert.equal(sent.length, 0);
  });
});

describe("POST /api/lender/withdraw", () => {
  test("période de prêt : Batch de deux Payment (parts → Bari, EURc de Bari → prêteur) à −0,5 %", async () => {
    resetMarket("investment");
    const shares = 500n * EUR;
    const response = await post("/api/lender/withdraw", { amount: shares.toString() }, sessions.lender);
    assert.equal(response.statusCode, HTTP_OK, response.body);
    const body = response.json<LenderTradeResponse>();
    const payout = exitPayout({ assets: 102_000n * EUR, shares: 100_000n * EUR }, shares);
    assert.equal(payout, 507_450_000n);
    assert.deepEqual([body.route, body.amount, body.shares], ["immediate", payout.toString(), shares.toString()]);
    assert.deepEqual(
      batches[0]?.inner.map(({ tx }) => (tx.TransactionType === "Payment" ? [tx.Account, tx.Destination, tx.Amount] : tx.TransactionType)),
      [
        [lender().address, bari.address, { mpt_issuance_id: SHARE_ID, value: shares.toString() }],
        [bari.address, lender().address, { mpt_issuance_id: ASSET_ID, value: payout.toString() }],
      ],
    );
  });

  test("au-delà de ce que la réserve de Bari rachète → 422", async () => {
    resetMarket("investment", 100n * EUR);
    const response = await post("/api/lender/withdraw", { amount: (500n * EUR).toString() }, sessions.lender);
    assert.equal(response.statusCode, HTTP_UNPROCESSABLE);
    assert.match(response.json<{ error: string }>().error, /immediate exit cap/);
    assert.equal(batches.length, 0);
  });

  test("plus de parts que le prêteur n'en a → 422", async () => {
    resetMarket("redemption");
    const response = await post("/api/lender/withdraw", { amount: (1_001n * EUR).toString() }, sessions.lender);
    assert.equal(response.statusCode, HTTP_UNPROCESSABLE);
    assert.match(response.json<{ error: string }>().error, /share balance/);
  });

  test("rachat : VaultWithdraw natif des parts, EURc reçus lus sur le ledger", async () => {
    resetMarket("redemption");
    const response = await post("/api/lender/withdraw", { amount: (400n * EUR).toString() }, sessions.lender);
    assert.equal(response.statusCode, HTTP_OK, response.body);
    const body = response.json<LenderTradeResponse>();
    assert.deepEqual([body.route, body.amount, body.shares], ["native", (400n * EUR).toString(), (400n * EUR).toString()]);
    assert.deepEqual(
      sent.map(({ tx, signer }) => [tx.TransactionType, signer, "Amount" in tx ? tx.Amount : undefined]),
      [["VaultWithdraw", lender().address, { mpt_issuance_id: SHARE_ID, value: (400n * EUR).toString() }]],
    );
  });
});

describe("POST /api/lender/faucet", () => {
  test("10 000 EURc de test de l'émetteur vers le compte géré du prêteur", async () => {
    resetMarket("investment");
    const response = await post("/api/lender/faucet", {}, sessions.lender);
    assert.equal(response.statusCode, HTTP_OK, response.body);
    assert.deepEqual(response.json<LenderFaucetResponse>(), { hash: TX_HASH, amount: (10_000n * EUR).toString(), transactions: [] });
    assert.deepEqual(sent, [
      {
        signer: stableIssuer.address,
        tx: {
          TransactionType: "Payment",
          Account: stableIssuer.address,
          Destination: lender().address,
          Amount: { mpt_issuance_id: ASSET_ID, value: (10_000n * EUR).toString() },
        },
      },
    ]);
  });
});
