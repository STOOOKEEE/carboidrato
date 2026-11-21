// Espace prêteur : position lue sur un faux ledger, chemin natif ou immédiat selon la phase, plafonds de Bari, garde de rôle ;
// prêteur wallet (Otsu) : ordre préparé par Bari, signé dans le wallet, vérifié octet par octet puis soumis, sans seed.

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { FastifyInstance } from "fastify";
import {
  decode,
  hashes,
  signMultiBatch,
  Wallet,
  type Batch,
  type LedgerEntry,
  type SubmittableTransaction,
  type Transaction,
} from "xrpl";
import type { UserRecord } from "../../../accounts/userStore.js";
import type { Fund } from "../../../fund/fund.js";
import { exitPayout, immediateLimits } from "../../../fund/sharePrice.js";
import type { PendingInner } from "../../../xrpl/batch.js";
import { FakeLedger } from "../../../xrpl/fakeLedger.js";
import type { LedgerTransaction } from "../../../xrpl/ledger.js";
import { SIGNING_WINDOW_LEDGERS, type WalletTxPorts } from "../../../xrpl/preparedTx.js";
import { RLUSD_CURRENCY, unitsToValue, valueToUnits, type Stablecoin } from "../../../xrpl/stablecoin.js";
import { UnexpectedTxResult, type TxOutcome } from "../../../xrpl/submit.js";
import type {
  LenderFaucetResponse,
  LenderOrderResponse,
  LenderPosition,
  LenderTradeResponse,
  PreparedSignature,
} from "../../contract.js";
import { buildApp } from "../app.js";
import { issueSession, SESSION_COOKIE } from "../auth.js";
import { fakeApiConfig, fakeContext } from "../fakeContext.js";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_UNPROCESSABLE = 422;
const PASSWORD = "correct horse battery";
/** 1 RLUSD en unités (6 décimales) ; une part affichée vaut aussi 10^6 unités de part. */
const RLUSD = 1_000_000n;

const SHARE_ID = "0B".repeat(24);
const VAULT_ID = "0C".repeat(32);
const BROKER_ID = "0D".repeat(32);
const TX_HASH = "EE".repeat(32);
const SUBSCRIPTION_END = 1_000;
const REDEMPTION_START = 2_000;
const PHASE_TIME = { subscription: 500, investment: 1_500, redemption: 2_500 } as const;
const WALLET_SEQUENCE = 40;
const BARI_SEQUENCE = 300;
const LEDGER_INDEX = 900;
const AUTOFILLED_FEE = "36";

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
const asset: Stablecoin = { currency: RLUSD_CURRENCY, issuer: stableIssuer.address };
const fund = {
  stablecoin: asset,
  domainId: "0E".repeat(32),
  brokerId: BROKER_ID,
  cohort: { vaultId: VAULT_ID, shareMptId: SHARE_ID, subscriptionDate: SUBSCRIPTION_END, redemptionDate: REDEMPTION_START },
  manifest: { debtorsRoot: "0F".repeat(32), vintage: 2026, registry: context.actors.bari_registry.address },
} satisfies Fund;

let app: FastifyInstance;
const sessions = { lender: "", business: "", wallet: "" };
const lender = () => {
  const wallet = managedWallets.get("lender");
  if (wallet === undefined) throw new Error("prêteur non inscrit");
  return wallet;
};

/** Faux nœud : un VaultDeposit (RLUSD) ou un VaultWithdraw (parts) au pair déplace les soldes, comme le ferait le ledger. */
async function moveVaultBalances(tx: SubmittableTransaction): Promise<void> {
  if ((tx.TransactionType === "VaultDeposit" || tx.TransactionType === "VaultWithdraw") && typeof tx.Amount === "object") {
    const units = "mpt_issuance_id" in tx.Amount ? BigInt(tx.Amount.value) : valueToUnits(tx.Amount.value);
    const sign = tx.TransactionType === "VaultDeposit" ? 1n : -1n;
    const [shares, balance] = await Promise.all([ledger.mptBalance(SHARE_ID, tx.Account), ledger.stablecoinBalance(asset, tx.Account)]);
    ledger.putMptBalance(SHARE_ID, tx.Account, shares + sign * units);
    ledger.putStablecoinBalance(asset, tx.Account, balance - sign * units);
  }
}

async function fakeSubmit(tx: SubmittableTransaction, wallet: Wallet): Promise<TxOutcome> {
  sent.push({ tx, signer: wallet.address });
  await moveVaultBalances(tx);
  return outcome;
}

const walletSubmitted: string[] = [];
const autofillSigners: (number | undefined)[] = [];
/** Résultat des transactions internes d'un Batch soumis ; undefined : absentes du ledger (rien n'est appliqué). */
let innerResult: string | undefined = "tesSUCCESS";
let submitFailure: Error | undefined;

/** Faux nœud du wallet : séquences fixes, frais complétés, blob signé « validé » (soldes déplacés, Batch appliqué). */
const walletPorts: WalletTxPorts = {
  accountState: async (account) => ({ sequence: account === bari.address ? BARI_SEQUENCE : WALLET_SEQUENCE, ledgerIndex: LEDGER_INDEX }),
  autofill: async (tx, signersCount) => {
    autofillSigners.push(signersCount);
    if (tx.TransactionType !== "Batch") return { ...tx, Fee: AUTOFILLED_FEE };
    const RawTransactions = tx.RawTransactions.map(({ RawTransaction }) => ({ RawTransaction: { ...RawTransaction, Fee: "0", SigningPubKey: "" } }));
    return { ...tx, Fee: AUTOFILLED_FEE, RawTransactions };
  },
  submitSigned: async (txBlob, hash) => {
    walletSubmitted.push(txBlob);
    if (submitFailure !== undefined) throw submitFailure;
    const tx = decode(txBlob) as unknown as SubmittableTransaction;
    await moveVaultBalances(tx);
    if (tx.TransactionType === "Batch" && innerResult !== undefined) {
      for (const { RawTransaction } of tx.RawTransactions) {
        const inner = { hash: hashes.hashSignedTx(RawTransaction), validated: true, meta: { TransactionResult: innerResult } };
        ledger.putTransaction(inner as unknown as LedgerTransaction);
      }
    }
    return { ...outcome, hash };
  },
};

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
    Asset: { currency: asset.currency, issuer: asset.issuer },
    AssetsTotal: unitsToValue(assetsTotal),
    AssetsAvailable: unitsToValue(assetsTotal),
    LossUnrealized: unitsToValue(lossUnrealized),
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
  TotalValueOutstanding: "9100",
  PrincipalOutstanding: "9000",
  PeriodicPayment: "9100",
  PreviousTxnID: TX_HASH,
  PreviousTxnLgrSeq: 1,
};

/** Fonds à 1,02 RLUSD la part : 103 000 RLUSD d'actifs, 1 000 de perte latente, 100 000 parts affichées. */
function resetMarket(phase: keyof typeof PHASE_TIME, bariReserve = 5_000n * RLUSD): void {
  sent.length = 0;
  batches.length = 0;
  walletSubmitted.length = 0;
  autofillSigners.length = 0;
  innerResult = "tesSUCCESS";
  submitFailure = undefined;
  ledger.setCloseTime(PHASE_TIME[phase]);
  putVault(103_000n * RLUSD, 1_000n * RLUSD, 100_000n * RLUSD);
  for (const holder of [lender().address, otsu.address]) {
    ledger.putStablecoinBalance(asset, holder, 20_000n * RLUSD);
    ledger.putMptBalance(SHARE_ID, holder, 1_000n * RLUSD);
  }
  ledger.putMptBalance(SHARE_ID, bari.address, 10_000n * RLUSD);
  ledger.putStablecoinBalance(asset, bari.address, bariReserve);
}

async function signup(body: object): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/auth/signup", payload: body });
  assert.equal(response.statusCode, 201, response.body);
  return String(response.headers["set-cookie"]).split(";")[0];
}

const get = (url: string, cookie?: string) => app.inject({ method: "GET", url, headers: cookie === undefined ? {} : { cookie } });
const post = (url: string, payload: object, cookie?: string) =>
  app.inject({ method: "POST", url, payload, headers: cookie === undefined ? {} : { cookie } });

/** Prêteur connecté par Otsu : Bari ne connaît que son adresse. */
const otsu = Wallet.generate();
let walletLender: UserRecord;

before(async () => {
  app = await buildApp(
    fakeApiConfig,
    context,
    {
      submit: fakeSubmit,
      submitBatch: async (submitter, cosigner, inner, label) => {
        batches.push({ submitter: submitter.address, cosigner: cosigner.address, inner, label });
        return outcome;
      },
    },
    walletPorts,
  );
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
  walletLender = context.users.createWalletUser({ role: "lender", profile: { name: "Wanda Verdi", country: "IT" }, address: otsu.address });
  sessions.wallet = `${SESSION_COOKIE}=${issueSession(context.users.sessionSecret, walletLender.id)}`;
});

after(() => app.close());

describe("garde de rôle", () => {
  const routes = [
    ["GET", "/api/lender/position", undefined],
    ["POST", "/api/lender/faucet", { amount: "1" }],
    ["POST", "/api/lender/deposit", { amount: "1" }],
    ["POST", "/api/lender/withdraw", { amount: "1" }],
    ["POST", "/api/lender/submit", { tx_blob: "00" }],
  ] as const;

  test("sans session → 401 ; entreprise → 403", async () => {
    for (const [method, url, payload] of routes) {
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
    const { maxExitShares } = immediateLimits({ assets: 102_000n * RLUSD, shares: 100_000n * RLUSD }, { shareStock: 0n, reserve: 5_000n * RLUSD });
    assert.deepEqual(response.json<LenderPosition>(), {
      phase: "investment",
      shares: (1_000n * RLUSD).toString(),
      value: (1_020n * RLUSD).toString(),
      costBasis: "0",
      gain: (1_020n * RLUSD).toString(),
      sharePrice: "1020000",
      // 9 000 RLUSD à 6 % × (1 − 1 %) / 103 000 RLUSD d'actifs ; le prêt soldé ne compte pas.
      variableYieldPercent: 0.519,
      rlusdBalance: (20_000n * RLUSD).toString(),
      entry: { route: "immediate", max: (10_200n * RLUSD).toString(), bariCap: (10_200n * RLUSD).toString() },
      exit: { route: "immediate", max: (1_000n * RLUSD).toString(), bariCap: maxExitShares.toString() },
      immediateExitDiscountPercent: 0.5,
    });
  });

  test("actifs du Vault au-delà de 6 décimales : arrondis à l'unité", async () => {
    putVault(103_000n * RLUSD, 1_000n * RLUSD, 100_000n * RLUSD);
    ledger.putVault({ ...(await ledger.vault(VAULT_ID)), AssetsTotal: "103000.0000004" });
    const position = (await get("/api/lender/position", sessions.lender)).json<LenderPosition>();
    assert.equal(position.sharePrice, "1020000");
  });

  test("pendant la souscription : chemin natif, plafond = solde du prêteur", async () => {
    resetMarket("subscription");
    const position = (await get("/api/lender/position", sessions.lender)).json<LenderPosition>();
    assert.equal(position.phase, "subscription");
    assert.deepEqual(position.entry, { route: "native", max: (20_000n * RLUSD).toString() });
    assert.deepEqual(position.exit, { route: "native", max: (1_000n * RLUSD).toString() });
  });

  test("pendant le rachat : dépôt fermé, retrait natif", async () => {
    resetMarket("redemption");
    const position = (await get("/api/lender/position", sessions.lender)).json<LenderPosition>();
    assert.deepEqual(position.entry, { route: null, max: "0" });
    assert.equal(position.exit.route, "native");
  });
});

describe("POST /api/lender/deposit", () => {
  test("souscription : VaultDeposit natif de RLUSD signé par le compte géré, prix de revient suivi", async () => {
    resetMarket("subscription");
    // Vault au pair pendant la souscription.
    putVault(100_000n * RLUSD, 0n, 100_000n * RLUSD);
    const response = await post("/api/lender/deposit", { amount: (2_000n * RLUSD).toString() }, sessions.lender);
    assert.equal(response.statusCode, HTTP_OK, response.body);
    const body = response.json<LenderTradeResponse>();
    assert.equal(body.route, "native");
    assert.equal(body.hash, TX_HASH);
    assert.equal(body.shares, (2_000n * RLUSD).toString());
    assert.deepEqual(body.transactions, []);
    assert.deepEqual(
      sent.map(({ tx, signer }) => [tx.TransactionType, signer, "Amount" in tx ? tx.Amount : undefined]),
      [["VaultDeposit", lender().address, { currency: RLUSD_CURRENCY, issuer: asset.issuer, value: "2000" }]],
    );
    assert.equal(batches.length, 0);
    const position = (await get("/api/lender/position", sessions.lender)).json<LenderPosition>();
    assert.equal(position.costBasis, (2_000n * RLUSD).toString());
    assert.equal(position.averageCost, "1000000");
  });

  test("période de prêt : Batch de deux Payment (RLUSD → Bari, parts de Bari → prêteur) au prix de la part", async () => {
    resetMarket("investment");
    const response = await post("/api/lender/deposit", { amount: (1_020n * RLUSD).toString() }, sessions.lender);
    assert.equal(response.statusCode, HTTP_OK, response.body);
    const body = response.json<LenderTradeResponse>();
    assert.deepEqual([body.route, body.amount, body.shares], ["immediate", (1_020n * RLUSD).toString(), (1_000n * RLUSD).toString()]);
    assert.equal(sent.length, 0);
    assert.equal(batches.length, 1);
    const [batch] = batches;
    assert.deepEqual([batch.submitter, batch.cosigner], [bari.address, lender().address]);
    assert.deepEqual(
      batch.inner.map(({ tx }) => (tx.TransactionType === "Payment" ? [tx.Account, tx.Destination, tx.Amount] : tx.TransactionType)),
      [
        [lender().address, bari.address, { currency: RLUSD_CURRENCY, issuer: asset.issuer, value: "1020" }],
        [bari.address, lender().address, { mpt_issuance_id: SHARE_ID, value: (1_000n * RLUSD).toString() }],
      ],
    );
  });

  test("au-delà du stock de parts de Bari → 422, rien n'est soumis", async () => {
    resetMarket("investment");
    const response = await post("/api/lender/deposit", { amount: (10_201n * RLUSD).toString() }, sessions.lender);
    assert.equal(response.statusCode, HTTP_UNPROCESSABLE);
    assert.match(response.json<{ error: string }>().error, /immediate entry cap/);
    assert.equal(batches.length + sent.length, 0);
  });

  test("au-delà du solde RLUSD → 422", async () => {
    resetMarket("subscription");
    const response = await post("/api/lender/deposit", { amount: (20_001n * RLUSD).toString() }, sessions.lender);
    assert.equal(response.statusCode, HTTP_UNPROCESSABLE);
    assert.match(response.json<{ error: string }>().error, /RLUSD balance/);
    assert.equal(sent.length, 0);
  });

  test("pendant le rachat → 422, montant invalide → 400", async () => {
    resetMarket("redemption");
    const closed = await post("/api/lender/deposit", { amount: RLUSD.toString() }, sessions.lender);
    assert.equal(closed.statusCode, HTTP_UNPROCESSABLE);
    assert.equal((await post("/api/lender/deposit", { amount: "-5" }, sessions.lender)).statusCode, 400);
    assert.equal(sent.length, 0);
  });
});

describe("POST /api/lender/withdraw", () => {
  test("période de prêt : Batch de deux Payment (parts → Bari, RLUSD de Bari → prêteur) à −0,5 %", async () => {
    resetMarket("investment");
    const shares = 500n * RLUSD;
    const response = await post("/api/lender/withdraw", { amount: shares.toString() }, sessions.lender);
    assert.equal(response.statusCode, HTTP_OK, response.body);
    const body = response.json<LenderTradeResponse>();
    const payout = exitPayout({ assets: 102_000n * RLUSD, shares: 100_000n * RLUSD }, shares);
    assert.equal(payout, 507_450_000n);
    assert.deepEqual([body.route, body.amount, body.shares], ["immediate", payout.toString(), shares.toString()]);
    assert.deepEqual(
      batches[0]?.inner.map(({ tx }) => (tx.TransactionType === "Payment" ? [tx.Account, tx.Destination, tx.Amount] : tx.TransactionType)),
      [
        [lender().address, bari.address, { mpt_issuance_id: SHARE_ID, value: shares.toString() }],
        [bari.address, lender().address, { currency: RLUSD_CURRENCY, issuer: asset.issuer, value: "507.45" }],
      ],
    );
  });

  test("au-delà de ce que la réserve de Bari rachète → 422", async () => {
    resetMarket("investment", 100n * RLUSD);
    const response = await post("/api/lender/withdraw", { amount: (500n * RLUSD).toString() }, sessions.lender);
    assert.equal(response.statusCode, HTTP_UNPROCESSABLE);
    assert.match(response.json<{ error: string }>().error, /immediate exit cap/);
    assert.equal(batches.length, 0);
  });

  test("plus de parts que le prêteur n'en a → 422", async () => {
    resetMarket("redemption");
    const response = await post("/api/lender/withdraw", { amount: (1_001n * RLUSD).toString() }, sessions.lender);
    assert.equal(response.statusCode, HTTP_UNPROCESSABLE);
    assert.match(response.json<{ error: string }>().error, /share balance/);
  });

  test("rachat : VaultWithdraw natif des parts, RLUSD reçus lus sur le ledger", async () => {
    resetMarket("redemption");
    const response = await post("/api/lender/withdraw", { amount: (400n * RLUSD).toString() }, sessions.lender);
    assert.equal(response.statusCode, HTTP_OK, response.body);
    const body = response.json<LenderTradeResponse>();
    assert.deepEqual([body.route, body.amount, body.shares], ["native", (400n * RLUSD).toString(), (400n * RLUSD).toString()]);
    assert.deepEqual(
      sent.map(({ tx, signer }) => [tx.TransactionType, signer, "Amount" in tx ? tx.Amount : undefined]),
      [["VaultWithdraw", lender().address, { mpt_issuance_id: SHARE_ID, value: (400n * RLUSD).toString() }]],
    );
  });
});

describe("POST /api/lender/faucet", () => {
  test("10 000 RLUSD de test : Payment de l'émetteur vers le compte géré du prêteur", async () => {
    resetMarket("investment");
    const response = await post("/api/lender/faucet", {}, sessions.lender);
    assert.equal(response.statusCode, HTTP_OK, response.body);
    assert.deepEqual(response.json<LenderFaucetResponse>(), { hash: TX_HASH, amount: (10_000n * RLUSD).toString(), transactions: [] });
    assert.deepEqual(sent, [
      {
        signer: stableIssuer.address,
        tx: {
          TransactionType: "Payment",
          Account: stableIssuer.address,
          Destination: lender().address,
          Amount: { currency: RLUSD_CURRENCY, issuer: stableIssuer.address, value: "10000" },
        },
      },
    ]);
  });
});

describe("prêteur wallet (Otsu) : Bari prépare, le wallet signe, Bari soumet", () => {
  /** Ce que fait Otsu : signe la transaction reçue, sans rien y changer. */
  const signed = (tx: Record<string, unknown>) => otsu.sign(tx as unknown as Transaction).tx_blob;
  const submitBlob = (txBlob: string, cookie = sessions.wallet) => post("/api/lender/submit", { tx_blob: txBlob }, cookie);

  async function prepared(action: "deposit" | "withdraw", amount: bigint): Promise<PreparedSignature> {
    const response = await post(`/api/lender/${action}`, { amount: amount.toString() }, sessions.wallet);
    assert.equal(response.statusCode, HTTP_OK, response.body);
    const body = response.json<LenderOrderResponse>();
    assert.ok("status" in body && body.status === "sign", response.body);
    return body;
  }

  test("position et faucet : l'adresse du wallet, sans seed", async () => {
    resetMarket("investment");
    ledger.putStablecoinBalance(asset, otsu.address, 7n * RLUSD);
    const position = (await get("/api/lender/position", sessions.wallet)).json<LenderPosition>();
    assert.equal(position.rlusdBalance, (7n * RLUSD).toString());
    const faucet = await post("/api/lender/faucet", {}, sessions.wallet);
    assert.equal(faucet.statusCode, HTTP_OK, faucet.body);
    assert.deepEqual(
      sent.map(({ tx, signer }) => [tx.TransactionType, signer, "Destination" in tx ? tx.Destination : undefined]),
      [["Payment", stableIssuer.address, otsu.address]],
    );
  });

  test("période de prêt : Batch préparé, compte du wallet à l'extérieur, BatchSigners de Bari, rien de soumis", async () => {
    resetMarket("investment");
    const body = await prepared("deposit", 1_020n * RLUSD);
    const tx = body.tx as unknown as Batch;
    assert.deepEqual(
      [tx.TransactionType, tx.Account, tx.Sequence, tx.Fee, tx.LastLedgerSequence],
      ["Batch", otsu.address, WALLET_SEQUENCE, AUTOFILLED_FEE, LEDGER_INDEX + SIGNING_WINDOW_LEDGERS],
    );
    assert.deepEqual(
      tx.RawTransactions.map(({ RawTransaction: inner }) => (inner.TransactionType === "Payment" ? [inner.Account, inner.Destination, inner.Amount, inner.Sequence] : [])),
      [
        [otsu.address, bari.address, { currency: RLUSD_CURRENCY, issuer: asset.issuer, value: "1020" }, WALLET_SEQUENCE + 1],
        [bari.address, otsu.address, { mpt_issuance_id: SHARE_ID, value: (1_000n * RLUSD).toString() }, BARI_SEQUENCE],
      ],
    );
    // Signature de Bari recalculée sur le même Batch : elle couvre le compte, la séquence, les flags et les ID internes.
    const { BatchSigners, ...unsigned } = tx;
    const expected = { ...unsigned } as Batch;
    signMultiBatch(bari, expected);
    assert.deepEqual(BatchSigners, expected.BatchSigners);
    assert.equal(BatchSigners?.[0]?.BatchSigner.Account, bari.address);
    assert.deepEqual(autofillSigners, [1]);
    assert.equal(body.labels.length, 2);
    assert.deepEqual(body.transactions, []);
    assert.equal(sent.length + batches.length + walletSubmitted.length, 0);
    assert.equal(walletLender.account, undefined);
  });

  test("blob signé tel quel : soumis, Batch entièrement appliqué, prix de revient suivi ; rejoué → 409", async () => {
    resetMarket("investment");
    const before = context.users.costBasis(walletLender.id);
    const body = await prepared("deposit", 1_020n * RLUSD);
    const txBlob = signed(body.tx);
    const response = await submitBlob(txBlob);
    assert.equal(response.statusCode, HTTP_OK, response.body);
    const trade = response.json<LenderTradeResponse>();
    const innerHashes = (body.tx as unknown as Batch).RawTransactions.map(({ RawTransaction }) => hashes.hashSignedTx(RawTransaction));
    assert.deepEqual(
      [trade.hash, trade.route, trade.phase, trade.amount, trade.shares],
      [hashes.hashSignedTx(txBlob), "immediate", "investment", (1_020n * RLUSD).toString(), (1_000n * RLUSD).toString()],
    );
    assert.deepEqual(trade.transactions.map(({ hash }) => hash), innerHashes);
    assert.deepEqual(walletSubmitted, [txBlob]);
    assert.deepEqual(context.users.costBasis(walletLender.id), { shares: before.shares + 1_000n * RLUSD, cost: before.cost + 1_020n * RLUSD });
    assert.equal((await submitBlob(txBlob)).statusCode, HTTP_CONFLICT);
  });

  test("blob modifié → 400, rien de soumis ; sans ordre préparé → 409", async () => {
    resetMarket("investment");
    const body = await prepared("deposit", 1_020n * RLUSD);
    const response = await submitBlob(signed({ ...body.tx, Fee: "1000" }));
    assert.equal(response.statusCode, HTTP_BAD_REQUEST);
    assert.equal(response.json<{ error: string }>().error, "This is not the transaction Bari prepared. Start again.");
    assert.equal(walletSubmitted.length, 0);
    const managed = await submitBlob(signed(body.tx), sessions.lender);
    assert.equal(managed.statusCode, HTTP_CONFLICT);
    assert.match(managed.json<{ error: string }>().error, /Nothing is waiting for your signature/);
  });

  test("souscription : VaultDeposit du wallet préparé, parts reçues lues sur le ledger après validation", async () => {
    resetMarket("subscription");
    putVault(100_000n * RLUSD, 0n, 100_000n * RLUSD);
    const before = context.users.costBasis(walletLender.id);
    const body = await prepared("deposit", 2_000n * RLUSD);
    assert.deepEqual(body.tx, {
      TransactionType: "VaultDeposit",
      Account: otsu.address,
      VaultID: VAULT_ID,
      Amount: { currency: RLUSD_CURRENCY, issuer: asset.issuer, value: "2000" },
      Sequence: WALLET_SEQUENCE,
      LastLedgerSequence: LEDGER_INDEX + SIGNING_WINDOW_LEDGERS,
      Fee: AUTOFILLED_FEE,
    });
    const response = await submitBlob(signed(body.tx));
    assert.equal(response.statusCode, HTTP_OK, response.body);
    const trade = response.json<LenderTradeResponse>();
    assert.deepEqual([trade.route, trade.amount, trade.shares], ["native", (2_000n * RLUSD).toString(), (2_000n * RLUSD).toString()]);
    assert.deepEqual(context.users.costBasis(walletLender.id), { shares: before.shares + 2_000n * RLUSD, cost: before.cost + 2_000n * RLUSD });
  });

  test("période de prêt, retrait : Batch de sortie (parts → Bari, RLUSD de Bari → wallet), vente enregistrée", async () => {
    resetMarket("investment");
    const shares = 500n * RLUSD;
    const body = await prepared("withdraw", shares);
    const tx = body.tx as unknown as Batch;
    assert.deepEqual(
      tx.RawTransactions.map(({ RawTransaction: inner }) => (inner.TransactionType === "Payment" ? [inner.Account, inner.Destination, inner.Amount] : [])),
      [
        [otsu.address, bari.address, { mpt_issuance_id: SHARE_ID, value: shares.toString() }],
        [bari.address, otsu.address, { currency: RLUSD_CURRENCY, issuer: asset.issuer, value: "507.45" }],
      ],
    );
    const before = context.users.costBasis(walletLender.id);
    const response = await submitBlob(signed(body.tx));
    assert.equal(response.statusCode, HTTP_OK, response.body);
    const trade = response.json<LenderTradeResponse>();
    assert.deepEqual([trade.route, trade.amount, trade.shares], ["immediate", "507450000", shares.toString()]);
    assert.equal(context.users.costBasis(walletLender.id).shares, before.shares - shares);
  });

  test("rachat : VaultWithdraw du wallet, RLUSD reçus lus sur le ledger", async () => {
    resetMarket("redemption");
    const body = await prepared("withdraw", 400n * RLUSD);
    assert.equal(body.tx.TransactionType, "VaultWithdraw");
    const trade = (await submitBlob(signed(body.tx))).json<LenderTradeResponse>();
    assert.deepEqual([trade.route, trade.amount, trade.shares], ["native", (400n * RLUSD).toString(), (400n * RLUSD).toString()]);
  });

  test("Batch validé sans ses transactions internes → 409, prix de revient inchangé", async () => {
    resetMarket("investment");
    innerResult = undefined;
    const before = context.users.costBasis(walletLender.id);
    // Montant propre à ce test : les mêmes transactions internes validées plus haut resteraient sur le faux ledger.
    const body = await prepared("deposit", 510n * RLUSD);
    const response = await submitBlob(signed(body.tx));
    assert.equal(response.statusCode, HTTP_CONFLICT);
    assert.match(response.json<{ error: string }>().error, /Nothing moved/);
    assert.deepEqual(context.users.costBasis(walletLender.id), before);
  });

  test("signé après son échéance → 409 : recommencer", async () => {
    resetMarket("investment");
    submitFailure = new UnexpectedTxResult("ordre", "tefMAX_LEDGER (Ledger sequence too high)", TX_HASH);
    const body = await prepared("deposit", 1_020n * RLUSD);
    const response = await submitBlob(signed(body.tx));
    assert.equal(response.statusCode, HTTP_CONFLICT);
    assert.match(response.json<{ error: string }>().error, /expired/);
  });

  test("les contrôles du compte géré s'appliquent : au-delà du solde → 422, rien de préparé", async () => {
    resetMarket("subscription");
    const response = await post("/api/lender/deposit", { amount: (20_001n * RLUSD).toString() }, sessions.wallet);
    assert.equal(response.statusCode, HTTP_UNPROCESSABLE);
    assert.equal(autofillSigners.length, 0);
  });
});
