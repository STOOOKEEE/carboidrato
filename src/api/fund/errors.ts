// Traduction des erreurs en réponses HTTP claires : validation (400), introuvable (404), conflit (409),
// refus du ledger ou de Bari (422), ledger injoignable (502), bogue (500).

import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ConnectionError, RippledError, TimeoutError, XrplError } from "xrpl";
import { DuplicateUser, type DuplicateField } from "../../accounts/userStore.js";
import { log } from "../../lib/logger.js";
import { UnexpectedTxResult } from "../../xrpl/submit.js";
import { InvalidInvoiceFile } from "../attestedInvoice.js";
import { OperationFailed } from "./operations.js";

const HTTP_BAD_REQUEST = 400;
const HTTP_CONFLICT = 409;
const HTTP_UNPROCESSABLE = 422;
const HTTP_BAD_GATEWAY = 502;
const HTTP_INTERNAL_ERROR = 500;

/** Erreur à renvoyer telle quelle, avec des détails publics éventuels. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const DUPLICATE_MESSAGES: Record<DuplicateField, string> = {
  email: "An account already exists for this email. Sign in instead.",
  vatNumber: "A business with this VAT number is already registered.",
  publicBody: "This public body already has an account.",
  address: "This wallet already has an Atlas account. Connect it to sign in.",
};

/** Erreurs de programmation : leur message n'est pas destiné au client. */
const PROGRAMMING_ERRORS = [TypeError, RangeError, ReferenceError, SyntaxError];

interface ErrorBody {
  error: string;
  [detail: string]: unknown;
}

function describe(error: unknown, explorerUrl: (hash: string) => string): { status: number; body: ErrorBody } {
  if (error instanceof HttpError) return { status: error.status, body: { error: error.message, ...error.details } };
  if (error instanceof InvalidInvoiceFile) return { status: HTTP_BAD_REQUEST, body: { error: error.message } };
  if (error instanceof DuplicateUser) return { status: HTTP_CONFLICT, body: { error: DUPLICATE_MESSAGES[error.field] } };
  if (error instanceof UnexpectedTxResult) {
    return {
      status: HTTP_UNPROCESSABLE,
      body: { error: error.message, result: error.result, hash: error.hash, explorerUrl: explorerUrl(error.hash) },
    };
  }
  if (error instanceof RippledError) {
    return { status: HTTP_UNPROCESSABLE, body: { error: `The XRP Ledger node refused the request: ${error.message}` } };
  }
  if (error instanceof ConnectionError || error instanceof TimeoutError || error instanceof XrplError) {
    return { status: HTTP_BAD_GATEWAY, body: { error: `The XRP Ledger node did not answer. Try again in a few seconds. (${error.message})` } };
  }
  if (error instanceof Error && !PROGRAMMING_ERRORS.some((type) => error instanceof type)) {
    // Refus métier (contrôles de Bari, phase du Vault, débiteur hors liste…) : message explicite.
    return { status: HTTP_UNPROCESSABLE, body: { error: error.message } };
  }
  log.warn(`erreur interne de l'API : ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  return { status: HTTP_INTERNAL_ERROR, body: { error: "Something went wrong on Atlas's side. Try again." } };
}

export function makeErrorHandler(explorerUrl: (hash: string) => string) {
  return (error: FastifyError | Error, _request: FastifyRequest, reply: FastifyReply): void => {
    if ("validation" in error && error.validation !== undefined) {
      void reply.status(HTTP_BAD_REQUEST).send({ error: error.message });
      return;
    }
    if (error instanceof OperationFailed) {
      // Transactions déjà soumises avant l'échec : le front peut les afficher.
      const { status, body } = describe(error.original, explorerUrl);
      void reply.status(status).send({ ...body, transactions: error.transactions });
      return;
    }
    const { status, body } = describe(error, explorerUrl);
    void reply.status(status).send(body);
  };
}
