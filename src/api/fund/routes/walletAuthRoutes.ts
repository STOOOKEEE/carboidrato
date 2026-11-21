// Connexion par wallet (Otsu), sans seed côté Bari : défi à usage unique, AccountSet signé jamais soumis, inscription.

import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { decode, deriveAddress, isValidClassicAddress, verifySignature, type AccountSet } from "xrpl";
import type { AccountProfile, WalletRole } from "../../../accounts/userStore.js";
import { SIGNING_WINDOW_LEDGERS, type WalletTxPorts } from "../../../xrpl/preparedTx.js";
import {
  WALLET_SIGNIN_MEMO_TYPE,
  type NetworkInfo,
  type WalletChallengeRequest,
  type WalletChallengeResponse,
  type WalletChallengeTransaction,
  type WalletRegisterRequest,
  type WalletRegisterResponse,
  type WalletVerifyRequest,
  type WalletVerifyResponse,
} from "../../contract.js";
import { issueSession, issueWalletRegistration, readWalletRegistration, sessionCookie } from "../auth.js";
import type { ApiContext } from "../context.js";
import { HttpError } from "../errors.js";
import { walletChallengeSchema, walletRegisterSchema, walletVerifySchema } from "../schemas.js";
import { accountProfile, accountView } from "./authRoutes.js";

const CHALLENGE_TTL_MS = 5 * 60_000;
const NONCE_BYTES = 32;
const HTTP_CREATED = 201;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_CONFLICT = 409;

type WalletAuthContext = Pick<ApiContext, "users" | "ledger" | "network" | "activateWallet">;

interface Challenge {
  address: string;
  expiresAtMs: number;
}

interface SignedChallenge {
  account: string;
  nonce: string;
}

interface Memo {
  Memo?: { MemoType?: unknown; MemoData?: unknown };
}

/**
 * Compte et nonce d'un AccountSet signé par la clé maîtresse de son compte, avec le seul mémo du défi ;
 * undefined pour tout le reste (blob illisible, autre transaction, clé régulière ou multisignature, signature fausse).
 */
function signedChallenge(txBlob: string): SignedChallenge | undefined {
  try {
    const { TransactionType, Account, SigningPubKey, Memos } = decode(txBlob);
    if (TransactionType !== "AccountSet" || typeof Account !== "string" || typeof SigningPubKey !== "string") return undefined;
    if (SigningPubKey === "" || deriveAddress(SigningPubKey) !== Account || !verifySignature(txBlob)) return undefined;
    const memo = Array.isArray(Memos) && Memos.length === 1 ? (Memos[0] as Memo).Memo : undefined;
    const { MemoType, MemoData } = memo ?? {};
    if (typeof MemoType !== "string" || MemoType.toUpperCase() !== WALLET_SIGNIN_MEMO_TYPE) return undefined;
    return typeof MemoData === "string" ? { account: Account, nonce: MemoData.toUpperCase() } : undefined;
  } catch {
    return undefined;
  }
}

export function registerWalletAuthRoutes(
  app: FastifyInstance,
  context: WalletAuthContext,
  walletPorts: Pick<WalletTxPorts, "accountState" | "autofill">,
): void {
  const challenges = new Map<string, Challenge>();
  // Une activation par adresse, même pour deux défis simultanés ; oubliée si elle échoue, pour être retentée.
  const activations = new Map<string, Promise<void>>();

  const activateOnce = (address: string): Promise<void> => {
    const pending = activations.get(address);
    if (pending !== undefined) return pending;
    const activation = context.activateWallet(address).catch((error: unknown) => {
      activations.delete(address);
      throw error;
    });
    activations.set(address, activation);
    return activation;
  };

  const signIn = (userId: string) => sessionCookie(issueSession(context.users.sessionSecret, userId));

  app.get("/api/network", async (): Promise<NetworkInfo> => {
    const networkId = context.ledger.networkId();
    return { ...(networkId === undefined ? {} : { networkId }), wsUrl: context.network.wsUrl };
  });

  app.post<{ Body: WalletChallengeRequest }>(
    "/api/auth/wallet/challenge",
    { schema: walletChallengeSchema },
    async (request): Promise<WalletChallengeResponse> => {
      const { address } = request.body;
      if (!isValidClassicAddress(address)) throw new HttpError(HTTP_BAD_REQUEST, "Not a valid XRPL address");
      await activateOnce(address);
      const now = Date.now();
      for (const [nonce, challenge] of challenges) if (challenge.expiresAtMs <= now) challenges.delete(nonce);
      const nonce = randomBytes(NONCE_BYTES).toString("hex").toUpperCase();
      const { sequence, ledgerIndex } = await walletPorts.accountState(address);
      const transaction = await walletPorts.autofill<AccountSet>({
        TransactionType: "AccountSet",
        Account: address,
        Memos: [{ Memo: { MemoType: WALLET_SIGNIN_MEMO_TYPE, MemoData: nonce } }],
        Sequence: sequence,
        LastLedgerSequence: ledgerIndex + SIGNING_WINDOW_LEDGERS,
      });
      const expiresAtMs = now + CHALLENGE_TTL_MS;
      challenges.set(nonce, { address, expiresAtMs });
      return { nonce, expiresAt: new Date(expiresAtMs).toISOString(), transaction: transaction as WalletChallengeTransaction };
    },
  );

  app.post<{ Body: WalletVerifyRequest }>("/api/auth/wallet/verify", { schema: walletVerifySchema }, async (request, reply) => {
    const signed = signedChallenge(request.body.tx_blob);
    const challenge = signed === undefined ? undefined : challenges.get(signed.nonce);
    if (signed === undefined || challenge === undefined) {
      throw new HttpError(HTTP_UNAUTHORIZED, "This signature does not answer a Bari sign-in request. Try again.");
    }
    challenges.delete(signed.nonce);
    if (challenge.expiresAtMs <= Date.now()) throw new HttpError(HTTP_UNAUTHORIZED, "This sign-in request expired. Try again.");
    if (challenge.address !== signed.account) {
      throw new HttpError(HTTP_UNAUTHORIZED, "Signed by another account than the one connected. Try again.");
    }

    const user = context.users.findByAddress(signed.account);
    if (user === undefined) {
      const body: WalletVerifyResponse = {
        status: "register",
        address: signed.account,
        token: issueWalletRegistration(context.users.sessionSecret, signed.account),
      };
      return body;
    }
    if (user.custody !== "wallet") throw new HttpError(HTTP_CONFLICT, "Bari manages this account: sign in with your email.");
    const body: WalletVerifyResponse = { status: "signedIn", user: accountView(user) };
    return reply.header("set-cookie", signIn(user.id)).send(body);
  });

  app.post<{ Body: WalletRegisterRequest }>(
    "/api/auth/wallet/register",
    { schema: walletRegisterSchema },
    async (request, reply) => {
      const address = readWalletRegistration(context.users.sessionSecret, request.body.token);
      if (address === undefined) throw new HttpError(HTTP_UNAUTHORIZED, "Your wallet signature expired. Connect your wallet again.");
      // Le schéma n'admet que les rôles d'un wallet.
      const profile = accountProfile(request.body) as Extract<AccountProfile, { role: WalletRole }>;
      const user = context.users.createWalletUser({ ...profile, address });
      const body: WalletRegisterResponse = { user: accountView(user) };
      return reply.status(HTTP_CREATED).header("set-cookie", signIn(user.id)).send(body);
    },
  );
}
