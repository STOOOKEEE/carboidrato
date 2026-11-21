// Connexion par wallet Otsu, pure : connexion, contrôle du réseau, défi signé (jamais soumis), vérification par l'API,
// et pour chaque erreur la solution à afficher.

import {
  WALLET_SIGNIN_MEMO_TYPE,
  type AccountView,
  type NetworkInfo,
  type WalletChallengeResponse,
  type WalletVerifyResponse,
} from "../../../../src/api/contract";
import { addNetworkSteps, checkNetwork, OTSU_REPO_URL } from "../../wallet/network";
import type { OtsuProvider } from "../../wallet/otsu";
import { REJECTED } from "../../wallet/sign";

export type WalletStep = "connecting" | "preparing" | "signing" | "verifying";

export type WalletFailure =
  | { kind: "missing" }
  | { kind: "wrongNetwork"; wsUrl: string; walletNetwork?: string }
  | { kind: "rejected" }
  | { kind: "expired" }
  | { kind: "error"; message: string };

export type WalletOutcome =
  | { kind: "signedIn"; user: AccountView }
  | { kind: "register"; address: string; token: string }
  | { kind: "failed"; failure: WalletFailure };

export interface WalletDeps {
  provider: OtsuProvider | undefined;
  fetchNetwork(): Promise<NetworkInfo>;
  challenge(address: string): Promise<WalletChallengeResponse>;
  verify(txBlob: string): Promise<WalletVerifyResponse>;
  now(): number;
}

/** Libellé de chaque étape, affiché pendant l'attente. */
export const STEP_LABELS: Record<WalletStep, string> = {
  connecting: "Approve the connection in Otsu…",
  preparing: "Preparing your sign-in request…",
  signing: "Sign the request in Otsu. It is never submitted to the ledger.",
  verifying: "Checking your signature…",
};

/** Autofill d'Otsu sur un nœud qui ne connaît pas le compte (activé par Bari sur son réseau). */
const ACCOUNT_NOT_FOUND = /actNotFound|Account not found/i;

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

const failed = (failure: WalletFailure): WalletOutcome => ({ kind: "failed", failure });

/** L'AccountSet que signe le wallet : il ne change rien au compte et Bari ne le soumet jamais. */
export function challengeTransaction(address: string, nonce: string): Record<string, unknown> {
  return {
    TransactionType: "AccountSet",
    Account: address,
    Memos: [{ Memo: { MemoType: WALLET_SIGNIN_MEMO_TYPE, MemoData: nonce } }],
  };
}

export async function signInWithWallet(deps: WalletDeps, onStep: (step: WalletStep) => void): Promise<WalletOutcome> {
  const { provider } = deps;
  if (provider === undefined) return failed({ kind: "missing" });
  let network: NetworkInfo | undefined;
  let challenge: WalletChallengeResponse | undefined;
  try {
    onStep("connecting");
    const { address } = await provider.connect();
    const [api, wallet] = await Promise.all([deps.fetchNetwork(), provider.getNetwork()]);
    network = api;
    const check = checkNetwork(wallet.network, api);
    if (check.kind === "mismatch") return failed({ kind: "wrongNetwork", wsUrl: api.wsUrl, walletNetwork: check.walletNetwork });

    onStep("preparing");
    challenge = await deps.challenge(address);
    onStep("signing");
    const { tx_blob: txBlob } = await provider.signTransaction(challengeTransaction(address, challenge.nonce));
    onStep("verifying");
    const verified = await deps.verify(txBlob);
    if (verified.status === "signedIn") return { kind: "signedIn", user: verified.user };
    return { kind: "register", address: verified.address, token: verified.token };
  } catch (cause) {
    const message = messageOf(cause);
    if (REJECTED.test(message)) return failed({ kind: "rejected" });
    if (network !== undefined && ACCOUNT_NOT_FOUND.test(message)) return failed({ kind: "wrongNetwork", wsUrl: network.wsUrl });
    if (challenge !== undefined && deps.now() >= Date.parse(challenge.expiresAt)) return failed({ kind: "expired" });
    return failed({ kind: "error", message });
  }
}

export interface FailureHelp {
  message: string;
  fix: string;
  link?: { href: string; label: string };
}

export function failureHelp(failure: WalletFailure): FailureHelp {
  switch (failure.kind) {
    case "missing":
      return {
        message: "Otsu wallet is not installed in this browser.",
        fix: "Install the Otsu extension, create or import a wallet, then reload this page.",
        link: { href: OTSU_REPO_URL, label: "Get Otsu wallet" },
      };
    case "wrongNetwork":
      return {
        message:
          failure.walletNetwork === undefined
            ? "Your wallet is not on Bari's network."
            : `Your wallet is on ${failure.walletNetwork}, not on Bari's network.`,
        fix: `Add Bari's network and select it: ${addNetworkSteps(failure.wsUrl)}`,
      };
    case "rejected":
      return { message: "The request was declined in Otsu.", fix: "Connect again and approve the request in the Otsu window." };
    case "expired":
      return { message: "Your sign-in request expired.", fix: "Connect again: it takes a few seconds." };
    case "error":
      return { message: failure.message, fix: "Connect again. If it keeps failing, continue with email." };
  }
}
