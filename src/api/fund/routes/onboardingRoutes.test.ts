// Ouverture d'un compte wallet par app.inject() : credential émis par Bari, transaction préparée à signer dans Otsu
// (seule ou en Batch), blob signé vérifié octet par octet puis soumis, sans réseau.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import type { FastifyInstance } from "fastify";
import {
  BatchFlags,
  decode,
  encode,
  GlobalFlags,
  hashes,
  Wallet,
  type Batch,
  type LedgerEntry,
  type SubmittableTransaction,
  type Transaction,
} from "xrpl";
import { UserStore, type UserRecord } from "../../../accounts/userStore.js";
import type { Fund } from "../../../fund/fund.js";
import { textToHex } from "../../../lib/encoding.js";
import { FakeLedger } from "../../../xrpl/fakeLedger.js";
import type { LedgerTransaction } from "../../../xrpl/ledger.js";
import { RLUSD_CURRENCY } from "../../../xrpl/stablecoin.js";
import { UnexpectedTxResult, type TxOutcome } from "../../../xrpl/submit.js";
import type { OnboardingPrepareResponse, OnboardingSubmitResponse } from "../../contract.js";
import { buildApp } from "../app.js";
import { issueSession, SESSION_COOKIE } from "../auth.js";
import { fakeApiConfig, fakeContext } from "../fakeContext.js";
import type { OnboardingPorts } from "./onboardingRoutes.js";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_CONFLICT = 409;
const HTTP_UNPROCESSABLE = 422;
const NOW_RIPPLE = 817_000_000;
const ONE_YEAR_S = 365 * 86_400;
const NEXT_SEQUENCE = 40;
const LEDGER_INDEX = 900;
/** ≈ 5 minutes de ledgers de 3 s pour signer dans la fenêtre d'Otsu. */
const SIGNING_WINDOW_LEDGERS = 100;
const AUTOFILLED_FEE = "36";
const SHARE_ID = "0B".repeat(24);
const LSF_ACCEPTED = 0x00010000;

const ledger = new FakeLedger(1000);
const usersFile = join(mkdtempSync(join(tmpdir(), "bari-onboarding-")), "users.json");
const context = fakeContext({ ledger, users: new UserStore(usersFile) });
const issuer = context.actors.kyb_issuer;
const asset = { currency: RLUSD_CURRENCY, issuer: context.actors.stable_issuer.address };
const fund = {
  stablecoin: asset,
  domainId: "0E".repeat(32),
  brokerId: "0D".repeat(32),
  cohort: { vaultId: "0C".repeat(32), shareMptId: SHARE_ID, subscriptionDate: 1_000, redemptionDate: 2_000 },
  manifest: { debtorsRoot: "0F".repeat(32), vintage: 2026, registry: context.actors.bari_registry.address },
} satisfies Fund;

const issued: { tx: SubmittableTransaction; signer: string }[] = [];
const submitted: { txBlob: string; hash: string }[] = [];
let submitFailure: Error | undefined;

const outcome = (hash: string): TxOutcome => ({
  hash,
  result: "tesSUCCESS",
  meta: { AffectedNodes: [], TransactionIndex: 0, TransactionResult: "tesSUCCESS" },
});

/** Faux nœud : un CredentialCreate dépose le credential (non accepté) sur le faux ledger. */
async function fakeSubmit(tx: SubmittableTransaction, wallet: Wallet): Promise<TxOutcome> {
  issued.push({ tx, signer: wallet.address });
  if (tx.TransactionType === "CredentialCreate") {
    ledger.putCredential({ Subject: tx.Subject, Issuer: tx.Account, CredentialType: tx.CredentialType, Flags: 0 } as LedgerEntry.Credential);
  }
  return outcome(`${issued.length}`.padStart(64, "C"));
}

const ports: OnboardingPorts = {
  accountState: async () => ({ sequence: NEXT_SEQUENCE, ledgerIndex: LEDGER_INDEX }),
  autofill: async (tx) => ({ ...tx, Fee: AUTOFILLED_FEE }),
  submitSigned: async (txBlob, hash) => {
    submitted.push({ txBlob, hash });
    if (submitFailure !== undefined) throw submitFailure;
    return outcome(hash);
  },
};

let app: FastifyInstance;

before(async () => {
  app = await buildApp(fakeApiConfig, context, { submit: fakeSubmit, submitBatch: async () => outcome("") }, ports);
  await app.ready();
  context.store.reset(fund);
  ledger.setCloseTime(NOW_RIPPLE);
});

after(() => app.close());

beforeEach(() => {
  issued.length = 0;
  submitted.length = 0;
  submitFailure = undefined;
});

let vatCounter = 10_000_000_000;

function walletUser(role: "lender" | "business"): { wallet: Wallet; user: UserRecord; cookie: string } {
  const wallet = Wallet.generate();
  const profile =
    role === "lender"
      ? ({ role, profile: { name: "Wanda Verdi", country: "IT" } } as const)
      : ({ role, profile: { company: "Wallet S.r.l.", vatNumber: `IT0${vatCounter++}` } } as const);
  const user = context.users.createWalletUser({ ...profile, address: wallet.address });
  return { wallet, user, cookie: `${SESSION_COOKIE}=${issueSession(context.users.sessionSecret, user.id)}` };
}

const prepare = (cookie?: string) =>
  app.inject({ method: "POST", url: "/api/onboarding/prepare", ...(cookie === undefined ? {} : { headers: { cookie } }) });

const submit = (cookie: string, txBlob: string) =>
  app.inject({ method: "POST", url: "/api/onboarding/submit", headers: { cookie }, payload: { tx_blob: txBlob } });

async function prepared(cookie: string): Promise<Extract<OnboardingPrepareResponse, { status: "sign" }>> {
  const response = await prepare(cookie);
  assert.equal(response.statusCode, HTTP_OK, response.body);
  const body = response.json<OnboardingPrepareResponse>();
  assert.equal(body.status, "sign");
  return body as Extract<OnboardingPrepareResponse, { status: "sign" }>;
}

/** Ce que fait Otsu : signe la transaction reçue, sans rien y changer. */
const signed = (wallet: Wallet, tx: Record<string, unknown>) => wallet.sign(tx as unknown as Transaction).tx_blob;

/** Le ledger valide les transactions internes du Batch avec ce résultat. */
function validateInner(tx: Batch, result = "tesSUCCESS"): string[] {
  return tx.RawTransactions.map(({ RawTransaction }) => {
    const hash = hashes.hashSignedTx(RawTransaction);
    ledger.putTransaction({ hash, validated: true, meta: { TransactionResult: result } } as unknown as LedgerTransaction);
    return hash;
  });
}

function trustLineOf(holder: string): LedgerEntry.LedgerEntry {
  return {
    LedgerEntryType: "RippleState",
    HighLimit: { currency: asset.currency, issuer: holder, value: "1" },
    LowLimit: { currency: asset.currency, issuer: asset.issuer, value: "0" },
  } as unknown as LedgerEntry.LedgerEntry;
}

function putCredential(holder: string, type: string, accepted: boolean): void {
  ledger.putCredential({
    Subject: holder,
    Issuer: issuer.address,
    CredentialType: textToHex(type),
    Flags: accepted ? LSF_ACCEPTED : 0,
  } as LedgerEntry.Credential);
}

describe("POST /api/onboarding/prepare", () => {
  test("prêteur neuf : KYC_INVESTOR émis par Bari, puis un Batch CredentialAccept + TrustSet + MPTokenAuthorize", async () => {
    const { wallet, cookie } = walletUser("lender");
    const body = await prepared(cookie);

    assert.equal(issued.length, 1);
    const [{ tx: create, signer }] = issued;
    assert.equal(signer, issuer.address);
    assert.equal(create.TransactionType, "CredentialCreate");
    const offer = create as unknown as Record<string, unknown>;
    assert.equal(offer.Subject, wallet.address);
    assert.equal(offer.CredentialType, textToHex("KYC_INVESTOR"));
    assert.equal(offer.Expiration, NOW_RIPPLE + ONE_YEAR_S);
    assert.ok(String(offer.URI).startsWith(textToHex("sha256:")));
    assert.deepEqual(body.transactions, [{ label: "KYC_INVESTOR credential issued by Bari", hash: "C".repeat(63) + "1" }]);

    const tx = body.tx as unknown as Batch;
    assert.equal(tx.TransactionType, "Batch");
    assert.equal(tx.Account, wallet.address);
    assert.equal(tx.Flags, BatchFlags.tfAllOrNothing);
    assert.equal(tx.Sequence, NEXT_SEQUENCE);
    assert.equal(tx.LastLedgerSequence, LEDGER_INDEX + SIGNING_WINDOW_LEDGERS);
    assert.equal(tx.Fee, AUTOFILLED_FEE);
    assert.equal(tx.BatchSigners, undefined);
    assert.deepEqual(
      tx.RawTransactions.map(({ RawTransaction: inner }) => [inner.TransactionType, inner.Account, inner.Sequence, inner.Fee, inner.SigningPubKey]),
      [
        ["CredentialAccept", wallet.address, NEXT_SEQUENCE + 1, "0", ""],
        ["TrustSet", wallet.address, NEXT_SEQUENCE + 2, "0", ""],
        ["MPTokenAuthorize", wallet.address, NEXT_SEQUENCE + 3, "0", ""],
      ],
    );
    for (const { RawTransaction: inner } of tx.RawTransactions) assert.equal(Number(inner.Flags) & GlobalFlags.tfInnerBatchTxn, GlobalFlags.tfInnerBatchTxn);
    assert.deepEqual(body.labels, ["Accept your KYC credential", "Open your RLUSD trust line", "Authorize vault shares"]);
  });

  test("entreprise au credential déjà émis : rien n'est réémis, Batch de 2 (CredentialAccept + TrustSet)", async () => {
    const { wallet, cookie } = walletUser("business");
    putCredential(wallet.address, "KYB_PME", false);
    const body = await prepared(cookie);
    assert.deepEqual(issued, []);
    assert.deepEqual(body.transactions, []);
    const tx = body.tx as unknown as Batch;
    assert.equal(tx.TransactionType, "Batch");
    assert.deepEqual(
      tx.RawTransactions.map(({ RawTransaction: inner }) => inner.TransactionType),
      ["CredentialAccept", "TrustSet"],
    );
    assert.deepEqual(body.labels, ["Accept your KYB credential", "Open your RLUSD trust line"]);
  });

  test("une seule transaction manquante : transaction seule, pas de Batch", async () => {
    const { wallet, cookie } = walletUser("lender");
    putCredential(wallet.address, "KYC_INVESTOR", true);
    ledger.putAccountObject(wallet.address, "mptoken", { LedgerEntryType: "MPToken", MPTokenIssuanceID: SHARE_ID } as unknown as LedgerEntry.LedgerEntry);
    const body = await prepared(cookie);
    const tx = body.tx as unknown as Record<string, unknown>;
    assert.equal(tx.TransactionType, "TrustSet");
    assert.equal(tx.Account, wallet.address);
    assert.equal(tx.Sequence, NEXT_SEQUENCE);
    assert.equal(tx.LastLedgerSequence, LEDGER_INDEX + SIGNING_WINDOW_LEDGERS);
    assert.equal(tx.Fee, AUTOFILLED_FEE);
    assert.equal(Number(tx.Flags ?? 0) & GlobalFlags.tfInnerBatchTxn, 0);
    assert.deepEqual(body.labels, ["Open your RLUSD trust line"]);
  });

  test("rien ne manque : prêt, sans rien à signer ; submit → 409", async () => {
    const { wallet, cookie } = walletUser("business");
    putCredential(wallet.address, "KYB_PME", true);
    ledger.putAccountObject(wallet.address, "state", trustLineOf(wallet.address));
    const response = await prepare(cookie);
    assert.equal(response.statusCode, HTTP_OK);
    assert.deepEqual(response.json<OnboardingPrepareResponse>(), { status: "ready", transactions: [] });
    assert.equal((await submit(cookie, "1200")).statusCode, HTTP_CONFLICT);
  });

  test("sans session → 401, organisme public → 403, compte géré → 409", async () => {
    assert.equal((await prepare()).statusCode, HTTP_UNAUTHORIZED);
    const publicBody = await context.users.create(
      { role: "public_body", profile: { ipaCode: "c_a662", name: "Comune di Bari" }, email: "pa@example.com", password: "correct horse" },
      undefined,
    );
    const managed = await context.users.create(
      { role: "lender", profile: { name: "Alice", country: "IT" }, email: "alice@example.com", password: "correct horse" },
      { address: Wallet.generate().address, seed: Wallet.generate().seed ?? "" },
    );
    const cookieOf = (user: UserRecord) => `${SESSION_COOKIE}=${issueSession(context.users.sessionSecret, user.id)}`;
    assert.equal((await prepare(cookieOf(publicBody))).statusCode, HTTP_FORBIDDEN);
    assert.equal((await prepare(cookieOf(managed))).statusCode, HTTP_CONFLICT);
    assert.equal((await submit(cookieOf(managed), "1200")).statusCode, HTTP_CONFLICT);
    assert.equal((await app.inject({ method: "POST", url: "/api/onboarding/submit", payload: { tx_blob: "1200" } })).statusCode, HTTP_UNAUTHORIZED);
    assert.deepEqual(issued, []);
  });
});

describe("POST /api/onboarding/submit", () => {
  test("Batch signé tel quel : soumis, transactions internes vérifiées, hashes renvoyés, puis oublié", async () => {
    const { wallet, cookie } = walletUser("lender");
    const { tx } = await prepared(cookie);
    const blob = signed(wallet, tx);
    const inner = validateInner(tx as unknown as Batch);

    const response = await submit(cookie, blob);
    assert.equal(response.statusCode, HTTP_OK, response.body);
    const batchHash = hashes.hashSignedTx(blob);
    assert.deepEqual(submitted, [{ txBlob: blob, hash: batchHash }]);
    assert.deepEqual(response.json<OnboardingSubmitResponse>().transactions, [
      { label: "Accept your KYC credential", hash: inner[0] },
      { label: "Open your RLUSD trust line", hash: inner[1] },
      { label: "Authorize vault shares", hash: inner[2] },
      { label: "All steps signed at once (Batch)", hash: batchHash },
    ]);
    assert.equal((await submit(cookie, blob)).statusCode, HTTP_CONFLICT);
  });

  test("transaction seule : son hash avec son libellé", async () => {
    const { wallet, cookie } = walletUser("business");
    putCredential(wallet.address, "KYB_PME", true);
    const { tx } = await prepared(cookie);
    const blob = signed(wallet, tx);
    const response = await submit(cookie, blob);
    assert.equal(response.statusCode, HTTP_OK, response.body);
    assert.deepEqual(response.json<OnboardingSubmitResponse>().transactions, [
      { label: "Open your RLUSD trust line", hash: hashes.hashSignedTx(blob) },
    ]);
  });

  test("blob modifié → 400, rien n'est soumis ; la transaction préparée reste signable", async () => {
    const { wallet, cookie } = walletUser("business");
    putCredential(wallet.address, "KYB_PME", true);
    const { tx } = await prepared(cookie);
    const tampered = await submit(cookie, signed(wallet, { ...tx, Fee: "1000" }));
    assert.equal(tampered.statusCode, HTTP_BAD_REQUEST);
    assert.match(tampered.json<{ error: string }>().error, /not the transaction Bari prepared/);
    const genuine = decode(signed(wallet, tx));
    const signature = String(genuine.TxnSignature);
    const forged = encode({
      ...(genuine as unknown as Transaction),
      TxnSignature: `${signature.slice(0, -2)}${signature.endsWith("00") ? "01" : "00"}`,
    });
    assert.equal((await submit(cookie, forged)).statusCode, HTTP_BAD_REQUEST);
    assert.equal((await submit(cookie, "00")).statusCode, HTTP_BAD_REQUEST);
    assert.deepEqual(submitted, []);
    assert.equal((await submit(cookie, signed(wallet, tx))).statusCode, HTTP_OK);
  });

  test("la transaction préparée d'un autre utilisateur ne compte pas → 409", async () => {
    const first = walletUser("business");
    putCredential(first.wallet.address, "KYB_PME", true);
    const { tx } = await prepared(first.cookie);
    const second = walletUser("business");
    assert.equal((await submit(second.cookie, signed(first.wallet, tx))).statusCode, HTTP_CONFLICT);
  });

  test("Batch validé sans ses transactions internes → 422", async () => {
    const { wallet, cookie } = walletUser("lender");
    const { tx } = await prepared(cookie);
    const response = await submit(cookie, signed(wallet, tx));
    assert.equal(response.statusCode, HTTP_UNPROCESSABLE);
  });

  test("Batch refusé (tec) → 422", async () => {
    const { wallet, cookie } = walletUser("lender");
    const { tx } = await prepared(cookie);
    submitFailure = new UnexpectedTxResult("Batch", "tecNO_PERMISSION", "AA".repeat(32));
    assert.equal((await submit(cookie, signed(wallet, tx))).statusCode, HTTP_UNPROCESSABLE);
  });

  test("signée trop tard (tefMAX_LEDGER) → 409 « expired »", async () => {
    const { wallet, cookie } = walletUser("lender");
    const { tx } = await prepared(cookie);
    submitFailure = new UnexpectedTxResult("Batch", "tefMAX_LEDGER (Ledger sequence too high.)", "AA".repeat(32));
    const response = await submit(cookie, signed(wallet, tx));
    assert.equal(response.statusCode, HTTP_CONFLICT);
    assert.match(response.json<{ error: string }>().error, /expired/);
  });
});

describe("aucune seed pour un compte wallet", () => {
  test("le fichier des utilisateurs ne contient ni seed ni compte géré pour les wallets", async () => {
    const { wallet, cookie } = walletUser("lender");
    await prepared(cookie);
    const { users } = JSON.parse(readFileSync(usersFile, "utf8")) as { users: Record<string, unknown>[] };
    const stored = users.filter((user) => user.custody === "wallet");
    assert.ok(stored.some((user) => user.address === wallet.address));
    for (const user of stored) {
      assert.equal(user.account, undefined);
      assert.doesNotMatch(JSON.stringify(user), /seed/i);
    }
  });
});
