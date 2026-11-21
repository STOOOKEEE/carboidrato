// Ouverture d'un compte wallet (Otsu), sans seed côté Bari : Bari émet le credential KYC/KYB, prépare la transaction que
// l'utilisateur signe dans son wallet (seule ou en Batch), puis soumet le blob signé s'il est exactement celui préparé.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { decode, encode, hashes, type SubmittableTransaction } from "xrpl";
import { credentialOffer, missingHoldings, ROLE_CREDENTIALS, userSteps, userTransaction } from "../../../kyb/onboarding.js";
import { textToHex } from "../../../lib/encoding.js";
import { matchesPrepared, PreparedStore, SIGNING_WINDOW_LEDGERS, type WalletTxPorts } from "../../../xrpl/preparedTx.js";
import { UnexpectedTxResult, type SubmitTx } from "../../../xrpl/submit.js";
import type {
  OnboardingPrepareResponse,
  OnboardingSubmitRequest,
  OnboardingSubmitResponse,
  OnboardingTx,
} from "../../contract.js";
import { currentUser } from "../auth.js";
import { requireFund, type ApiContext } from "../context.js";
import { HttpError } from "../errors.js";
import { onboardingSubmitSchema } from "../schemas.js";

const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_CONFLICT = 409;
const SUCCESS = "tesSUCCESS";
/** Résultat préliminaire d'une transaction soumise après son LastLedgerSequence. */
const EXPIRED = "tefMAX_LEDGER";
const BATCH_LABEL = "All steps signed at once (Batch)";

/** Transaction préparée en attente de signature ; les hashes internes d'un Batch sont connus avant sa soumission. */
interface Prepared {
  tx: SubmittableTransaction;
  labels: string[];
  innerHashes: string[];
}

function walletUser(context: ApiContext, request: FastifyRequest) {
  const user = currentUser(context, request);
  if (user === undefined) throw new HttpError(HTTP_UNAUTHORIZED, "Sign in to continue");
  if (user.role === "public_body") throw new HttpError(HTTP_FORBIDDEN, "Public bodies have no XRPL account to open");
  if (user.custody !== "wallet") throw new HttpError(HTTP_CONFLICT, "Bari already opened your account.");
  return user;
}

/** Toutes les transactions internes validées et en tesSUCCESS (tfAllOrNothing : toutes ou aucune). */
async function innerApplied(context: ApiContext, innerHashes: readonly string[]): Promise<boolean> {
  const found = await Promise.all(innerHashes.map((hash) => context.ledger.transaction(hash)));
  return found.every((tx) => tx?.validated === true && typeof tx.meta === "object" && tx.meta.TransactionResult === SUCCESS);
}

export function registerOnboardingRoutes(
  app: FastifyInstance,
  context: ApiContext,
  submit: SubmitTx,
  ports: WalletTxPorts,
): void {
  // En mémoire : un redémarrage oblige seulement à recommencer.
  const prepared = new PreparedStore<Prepared>();

  app.post("/api/onboarding/prepare", async (request): Promise<OnboardingPrepareResponse> => {
    const user = walletUser(context, request);
    const { fund } = requireFund(context);
    const tokens = { stablecoin: fund.stablecoin, shareMptId: fund.cohort.shareMptId };
    const issuer = context.actors.kyb_issuer;
    const type = ROLE_CREDENTIALS[user.role];

    const transactions: OnboardingTx[] = [];
    const credential = await context.ledger.credential(user.address, issuer.address, textToHex(type));
    if (credential === undefined) {
      const label = `${type} credential issued by Bari`;
      const offer = credentialOffer(issuer.address, user.address, user, await context.ledger.closeTime());
      const { hash } = await submit(offer, issuer, label);
      transactions.push({ label, hash });
    }

    const missing = await missingHoldings(context.ledger, tokens, user.address, user.role);
    const steps = userSteps(issuer.address, user.address, user.role, credential, missing);
    if (steps.length === 0) {
      prepared.delete(user.id);
      return { status: "ready", transactions };
    }

    const { sequence, ledgerIndex } = await ports.accountState(user.address);
    const tx = await ports.autofill(
      userTransaction(user.address, steps.map((step) => step.tx), sequence, ledgerIndex + SIGNING_WINDOW_LEDGERS),
    );
    const labels = steps.map((step) => step.label);
    const innerHashes =
      tx.TransactionType === "Batch" ? tx.RawTransactions.map(({ RawTransaction }) => hashes.hashSignedTx(RawTransaction)) : [];
    prepared.set(user.id, { tx, labels, innerHashes });
    return { status: "sign", tx: decode(encode(tx)), labels, transactions };
  });

  app.post<{ Body: OnboardingSubmitRequest }>(
    "/api/onboarding/submit",
    { schema: onboardingSubmitSchema },
    async (request): Promise<OnboardingSubmitResponse> => {
      const user = walletUser(context, request);
      const pending = prepared.get(user.id);
      if (pending === undefined) throw new HttpError(HTTP_CONFLICT, "Nothing is waiting for your signature. Start again.");
      const txBlob = request.body.tx_blob;
      if (!matchesPrepared(pending.tx, txBlob)) {
        throw new HttpError(HTTP_BAD_REQUEST, "This is not the transaction Bari prepared. Start again.");
      }
      // Oubliée avant la soumission : la séquence est consommée quoi qu'il arrive, elle ne se resoumet pas.
      prepared.delete(user.id);

      const hash = hashes.hashSignedTx(txBlob);
      const label = `Account opening (${user.address})`;
      await ports.submitSigned(txBlob, hash, label).catch((error: unknown) => {
        if (error instanceof UnexpectedTxResult && error.result.startsWith(EXPIRED)) {
          throw new HttpError(HTTP_CONFLICT, "This request expired before it reached the ledger. Start again.");
        }
        throw error;
      });
      if (pending.innerHashes.length === 0) return { transactions: [{ label: pending.labels[0] ?? label, hash }] };
      if (!(await innerApplied(context, pending.innerHashes))) {
        throw new UnexpectedTxResult(label, "inner transactions not applied", hash);
      }
      return {
        transactions: [
          ...pending.innerHashes.map((innerHash, index) => ({ label: pending.labels[index] ?? label, hash: innerHash })),
          { label: BATCH_LABEL, hash },
        ],
      };
    },
  );
}
