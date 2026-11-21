// Connexion par wallet (Otsu) par app.inject() : défi, AccountSet signé jamais soumis, inscription, session, sans réseau.

import assert from "node:assert/strict";
import { after, afterEach, before, describe, mock, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { decode, encode, Wallet, type AccountSet } from "xrpl";
import { SIGNING_WINDOW_LEDGERS, type WalletTxPorts } from "../../../xrpl/preparedTx.js";
import {
  WALLET_SIGNIN_MEMO_TYPE,
  type AccountView,
  type NetworkInfo,
  type WalletChallengeResponse,
  type WalletRegisterResponse,
  type WalletVerifyResponse,
} from "../../contract.js";
import { buildApp } from "../app.js";
import { requireRole } from "../auth.js";
import { fakeApiConfig, fakeContext } from "../fakeContext.js";

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_CONFLICT = 409;
const CHALLENGE_TTL_MS = 5 * 60_000;
const NETWORK_ID = 1000;
const NEXT_SEQUENCE = 7;
const LEDGER_INDEX = 900;
const FEE = "12";

/** Lectures du nœud de Bari (séquence, dernier ledger) et frais : ce que l'AccountSet du défi embarque. */
const walletPorts: WalletTxPorts = {
  accountState: async () => ({ sequence: NEXT_SEQUENCE, ledgerIndex: LEDGER_INDEX }),
  autofill: async (tx) => ({ ...tx, Fee: FEE }),
  submitSigned: async () => {
    throw new Error("la connexion ne soumet rien");
  },
};

const lenderProfile = { name: "Wanda Verdi", country: "IT", riskAcknowledged: true };
const businessProfile = { company: "Wallet Costruzioni S.r.l.", vatNumber: "IT55555555555" };

const activated: string[] = [];
let app: FastifyInstance;

before(async () => {
  const context = fakeContext({
    activateWallet: async (address) => {
      activated.push(address);
    },
  });
  app = await buildApp(fakeApiConfig, context, undefined, walletPorts);
  app.get("/test/lender-only", { preHandler: requireRole(context, "lender") }, async () => ({ ok: true }));
  await app.ready();
});

after(() => app.close());

afterEach(() => mock.timers.reset());

function sessionCookie(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  assert.ok(header !== undefined, "Set-Cookie attendu");
  return header.split(";")[0];
}

async function challenge(address: string): Promise<WalletChallengeResponse> {
  const response = await app.inject({ method: "POST", url: "/api/auth/wallet/challenge", payload: { address } });
  assert.equal(response.statusCode, HTTP_OK);
  return response.json<WalletChallengeResponse>();
}

/** Ce que renvoie Otsu : l'AccountSet complété (autofill) puis signé par le wallet, jamais soumis. */
function signChallenge(wallet: Wallet, nonce: string, overrides: Partial<AccountSet> = {}): string {
  const tx: AccountSet = {
    TransactionType: "AccountSet",
    Account: wallet.address,
    Fee: "12",
    Sequence: 7,
    LastLedgerSequence: 1_000,
    Memos: [{ Memo: { MemoType: WALLET_SIGNIN_MEMO_TYPE, MemoData: nonce } }],
    ...overrides,
  };
  return wallet.sign(tx).tx_blob;
}

const verify = (txBlob: string) => app.inject({ method: "POST", url: "/api/auth/wallet/verify", payload: { tx_blob: txBlob } });

const register = (body: object) => app.inject({ method: "POST", url: "/api/auth/wallet/register", payload: body });

async function registrationToken(wallet: Wallet): Promise<string> {
  const { nonce } = await challenge(wallet.address);
  const response = await verify(signChallenge(wallet, nonce));
  assert.equal(response.statusCode, HTTP_OK);
  const body = response.json<WalletVerifyResponse>();
  assert.equal(body.status, "register");
  assert.equal(response.headers["set-cookie"], undefined);
  return body.status === "register" ? body.token : "";
}

async function me(cookie: string): Promise<AccountView> {
  const response = await app.inject({ method: "GET", url: "/api/me", headers: { cookie } });
  assert.equal(response.statusCode, HTTP_OK);
  return response.json<AccountView>();
}

describe("GET /api/network", () => {
  test("NetworkID et URL WebSocket publique du nœud de l'API", async () => {
    const response = await app.inject({ method: "GET", url: "/api/network" });
    assert.equal(response.statusCode, HTTP_OK);
    assert.deepEqual(response.json<NetworkInfo>(), { networkId: NETWORK_ID, wsUrl: "wss://alphanet.example" });
  });
});

describe("POST /api/auth/wallet/challenge", () => {
  test("nonce hex de 32 octets, valable 5 minutes, différent à chaque défi", async () => {
    const wallet = Wallet.generate();
    const before = Date.now();
    const first = await challenge(wallet.address);
    const second = await challenge(wallet.address);
    assert.match(first.nonce, /^[0-9A-F]{64}$/);
    assert.notEqual(first.nonce, second.nonce);
    const expiresAt = Date.parse(first.expiresAt);
    assert.ok(expiresAt >= before + CHALLENGE_TTL_MS && expiresAt <= Date.now() + CHALLENGE_TTL_MS);
  });

  test("compte activé une seule fois par adresse", async () => {
    const wallet = Wallet.generate();
    await Promise.all([challenge(wallet.address), challenge(wallet.address)]);
    await challenge(wallet.address);
    assert.equal(activated.filter((address) => address === wallet.address).length, 1);
  });

  test("AccountSet complet (séquence, frais, dernier ledger) : Otsu le signe sans rien lire sur son propre réseau", async () => {
    const wallet = Wallet.generate();
    const { nonce, transaction } = await challenge(wallet.address);
    assert.deepEqual(transaction, {
      TransactionType: "AccountSet",
      Account: wallet.address,
      Memos: [{ Memo: { MemoType: WALLET_SIGNIN_MEMO_TYPE, MemoData: nonce } }],
      Sequence: NEXT_SEQUENCE,
      LastLedgerSequence: LEDGER_INDEX + SIGNING_WINDOW_LEDGERS,
      Fee: FEE,
    });
    const response = await verify(wallet.sign(transaction).tx_blob);
    assert.equal(response.statusCode, HTTP_OK);
  });

  test("adresse invalide → 400, rien n'est activé", async () => {
    const count = activated.length;
    for (const address of ["not-an-address", "rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr", `X${"7".repeat(46)}`]) {
      const response = await app.inject({ method: "POST", url: "/api/auth/wallet/challenge", payload: { address } });
      assert.equal(response.statusCode, HTTP_BAD_REQUEST, address);
    }
    assert.equal(activated.length, count);
  });
});

describe("POST /api/auth/wallet/verify", () => {
  test("signature invalide → 401", async () => {
    const wallet = Wallet.generate();
    const { nonce } = await challenge(wallet.address);
    const tampered = encode({ ...(decode(signChallenge(wallet, nonce)) as unknown as AccountSet), Fee: "13" });
    assert.equal((await verify(tampered)).statusCode, HTTP_UNAUTHORIZED);
  });

  test("nonce rejoué → 401", async () => {
    const wallet = Wallet.generate();
    const { nonce } = await challenge(wallet.address);
    const blob = signChallenge(wallet, nonce);
    assert.equal((await verify(blob)).statusCode, HTTP_OK);
    assert.equal((await verify(blob)).statusCode, HTTP_UNAUTHORIZED);
  });

  test("défi expiré → 401", async () => {
    mock.timers.enable({ apis: ["Date"], now: Date.now() });
    const wallet = Wallet.generate();
    const { nonce } = await challenge(wallet.address);
    mock.timers.tick(CHALLENGE_TTL_MS + 1);
    assert.equal((await verify(signChallenge(wallet, nonce))).statusCode, HTTP_UNAUTHORIZED);
  });

  test("signé par une autre adresse que celle du défi → 401", async () => {
    const challenged = Wallet.generate();
    const { nonce } = await challenge(challenged.address);
    assert.equal((await verify(signChallenge(Wallet.generate(), nonce))).statusCode, HTTP_UNAUTHORIZED);
  });

  test("clé régulière (SigningPubKey qui ne dérive pas vers Account) → 401", async () => {
    const account = Wallet.generate();
    const regularKey = Wallet.generate();
    const { nonce } = await challenge(account.address);
    const signer = new Wallet(regularKey.publicKey, regularKey.privateKey, { masterAddress: account.address });
    assert.equal((await verify(signChallenge(signer, nonce))).statusCode, HTTP_UNAUTHORIZED);
  });

  test("autre transaction qu'un AccountSet, mémo absent ou nonce inconnu → 401", async () => {
    const wallet = Wallet.generate();
    const { nonce } = await challenge(wallet.address);
    const payment = wallet.sign({
      TransactionType: "Payment",
      Account: wallet.address,
      Destination: Wallet.generate().address,
      Amount: "1",
      Fee: "12",
      Sequence: 7,
      Memos: [{ Memo: { MemoType: WALLET_SIGNIN_MEMO_TYPE, MemoData: nonce } }],
    }).tx_blob;
    assert.equal((await verify(payment)).statusCode, HTTP_UNAUTHORIZED);
    assert.equal((await verify(signChallenge(wallet, nonce, { Memos: [] }))).statusCode, HTTP_UNAUTHORIZED);
    assert.equal((await verify(signChallenge(wallet, "AB".repeat(32)))).statusCode, HTTP_UNAUTHORIZED);
    assert.equal((await verify("00")).statusCode, HTTP_UNAUTHORIZED);
  });
});

describe("inscription par wallet", () => {
  test("prêteur : jeton → inscription → cookie → GET /api/me sans email ; reconnexion directe", async () => {
    const wallet = Wallet.generate();
    const token = await registrationToken(wallet);
    const created = await register({ token, role: "lender", profile: lenderProfile });
    assert.equal(created.statusCode, HTTP_CREATED);
    const { user } = created.json<WalletRegisterResponse>();
    assert.deepEqual(user, {
      custody: "wallet",
      address: wallet.address,
      verification: "basic (self-declared)",
      role: "lender",
      profile: { name: "Wanda Verdi", country: "IT" },
    });
    assert.deepEqual(await me(sessionCookie(created.headers["set-cookie"])), user);

    const { nonce } = await challenge(wallet.address);
    const again = await verify(signChallenge(wallet, nonce));
    assert.equal(again.statusCode, HTTP_OK);
    assert.deepEqual(again.json<WalletVerifyResponse>(), { status: "signedIn", user });
    assert.equal((await me(sessionCookie(again.headers["set-cookie"]))).address, wallet.address);
  });

  test("entreprise : TVA normalisée et unique ; adresse déjà inscrite → 409", async () => {
    const wallet = Wallet.generate();
    const token = await registrationToken(wallet);
    const created = await register({ token, role: "business", profile: { ...businessProfile, vatNumber: "it 5555 5555 555" } });
    assert.equal(created.statusCode, HTTP_CREATED);
    assert.deepEqual(created.json<WalletRegisterResponse>().user.profile, businessProfile);
    assert.equal((await register({ token, role: "lender", profile: lenderProfile })).statusCode, HTTP_CONFLICT);

    const other = await registrationToken(Wallet.generate());
    assert.equal((await register({ token: other, role: "business", profile: businessProfile })).statusCode, HTTP_CONFLICT);
  });

  test("organisme public, profil incomplet ou champ en trop → 400", async () => {
    const token = await registrationToken(Wallet.generate());
    const invalid = [
      { token, role: "public_body", profile: { ipaCode: "c_a662" } },
      { token, role: "lender", profile: { ...lenderProfile, riskAcknowledged: false } },
      { token, role: "lender", profile: lenderProfile, email: "x@example.com" },
    ];
    for (const body of invalid) assert.equal((await register(body)).statusCode, HTTP_BAD_REQUEST);
  });

  test("jeton falsifié, expiré ou cookie de session à la place → 401", async () => {
    const wallet = Wallet.generate();
    mock.timers.enable({ apis: ["Date"], now: Date.now() });
    const token = await registrationToken(wallet);
    const forged = `${token.slice(0, -2)}${token.endsWith("AA") ? "BB" : "AA"}`;
    assert.equal((await register({ token: forged, role: "lender", profile: lenderProfile })).statusCode, HTTP_UNAUTHORIZED);

    const lender = await register({ token: await registrationToken(Wallet.generate()), role: "lender", profile: lenderProfile });
    const sessionToken = sessionCookie(lender.headers["set-cookie"]).split("=")[1];
    assert.equal((await register({ token: sessionToken, role: "lender", profile: lenderProfile })).statusCode, HTTP_UNAUTHORIZED);

    mock.timers.tick(24 * 60 * 60_000);
    assert.equal((await register({ token, role: "lender", profile: lenderProfile })).statusCode, HTTP_UNAUTHORIZED);
  });
});

describe("requireRole pour un compte wallet", () => {
  test("sans session → 401, entreprise → 403, prêteur → 200", async () => {
    assert.equal((await app.inject({ method: "GET", url: "/test/lender-only" })).statusCode, HTTP_UNAUTHORIZED);
    const business = await register({
      token: await registrationToken(Wallet.generate()),
      role: "business",
      profile: { company: "Guard S.r.l.", vatNumber: "IT66666666666" },
    });
    const asBusiness = await app.inject({
      method: "GET",
      url: "/test/lender-only",
      headers: { cookie: sessionCookie(business.headers["set-cookie"]) },
    });
    assert.equal(asBusiness.statusCode, HTTP_FORBIDDEN);
    const lender = await register({ token: await registrationToken(Wallet.generate()), role: "lender", profile: lenderProfile });
    const asLender = await app.inject({
      method: "GET",
      url: "/test/lender-only",
      headers: { cookie: sessionCookie(lender.headers["set-cookie"]) },
    });
    assert.equal(asLender.statusCode, HTTP_OK);
  });
});
