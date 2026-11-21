// Côté entreprise : lectures publiques du pré-contrôle (registre de N, KYB, barème de l'offre), puis, pour le compte géré
// de la session, certificat à partir d'une preuve calculée dans le navigateur, prêt co-signé et factures du compte.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { isValidClassicAddress, rippleTimeToISOTime, rippleTimeToUnixTime, Wallet } from "xrpl";
import type { InvoiceCertificate } from "../../../invoice/certificate.js";
import { issueCertificate } from "../../../invoice/issueCertificate.js";
import { getRegistration } from "../../../invoice/registry.js";
import { isSmeKybDone } from "../../../kyb/smeKyb.js";
import { LoanRefused, originateLoan } from "../../../lending/loan.js";
import { latestLoanMaturity } from "../../../lending/loanTerms.js";
import type { BusinessInvoice, KybStatus, LoanResponse, OfferSchedule, RegistryLookup } from "../../contract.js";
import { fundOffer } from "../../offer.js";
import { requireRole, sessionUser } from "../auth.js";
import { certificateFromProof } from "../certificateFromProof.js";
import { proofExpectations, requireFund, type ApiContext } from "../context.js";
import { HttpError } from "../errors.js";
import { OperationFailed } from "../operations.js";
import {
  accountParamsSchema,
  certificateSchema,
  loanSchema,
  offerSchema,
  registrySchema,
  type AccountParams,
  type CertificateBody,
  type LoanBody,
  type OfferQuery,
  type RegistryParams,
  type RegistryQuery,
} from "../schemas.js";
import { loanState } from "../stateStore.js";

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_UNPROCESSABLE = 422;
const HTTP_CREATED = 201;
const DUPLICATE_RESULT = "tecDUPLICATE";
const MS_PER_SECOND = 1_000;

function requireAddress(account: string): string {
  if (!isValidClassicAddress(account)) throw new HttpError(HTTP_BAD_REQUEST, "Invalid XRPL address");
  return account;
}

/** Compte XRPL géré de l'entreprise de la session : Bari signe pour elle, la seed ne sort jamais de l'API. */
function businessWallet(request: FastifyRequest): Wallet {
  const { account } = sessionUser(request, "business");
  if (account === undefined) throw new HttpError(HTTP_CONFLICT, "This business has no XRPL account yet");
  return Wallet.fromSeed(account.seed);
}

/** Enregistrement de N → MPT facture → remise à Bari. 409 si N est déjà enregistré (refinancement refusé). */
async function issue(context: ApiContext, sme: Wallet, certificate: InvoiceCertificate) {
  requireFund(context);
  const { actors, client } = context;
  const { result: issued, transactions } = await context.operations.run("sme.certificate", () =>
    issueCertificate(client, { sme, bari: actors.bari, registry: actors.bari_registry.address }, certificate),
  );
  if (issued === undefined) {
    // Séquentiel : le CredentialCreate en tecDUPLICATE ; Batch : le Batch validé dont rien n'a été appliqué.
    const rejectedBy = transactions.find((tx) => tx.result === DUPLICATE_RESULT) ?? transactions[0];
    throw new HttpError(HTTP_CONFLICT, "Invoice already registered: the ledger refuses double financing", {
      nullifier: certificate.nullifier,
      hash: rejectedBy?.hash,
      explorerUrl: rejectedBy?.explorerUrl,
      rejectedBy,
      transactions,
    });
  }
  context.store.update((state) => {
    // La première transaction de l'opération est le Batch du certificat.
    state.invoices.push({
      tokenId: issued.tokenId,
      certificate,
      issuedAt: new Date().toISOString(),
      owner: sme.address,
      txHash: transactions[0]?.hash,
    });
  });
  return {
    tokenId: issued.tokenId,
    nullifier: certificate.nullifier,
    pseudonym: certificate.pseudonym,
    commitment: certificate.commitment,
    proofSystem: certificate.proofSystem,
    transactions,
  };
}

/** Contrôles puis LoanSet co-signé ; un refus de Bari devient un 422 avec la liste des contrôles. */
async function lend(context: ApiContext, borrower: Wallet, tokenId: string): Promise<LoanResponse> {
  const state = requireFund(context);
  const invoice = state.invoices.find((candidate) => candidate.tokenId === tokenId && candidate.owner === borrower.address);
  if (invoice === undefined) throw new HttpError(HTTP_NOT_FOUND, `Unknown invoice token for this account: ${tokenId}`);
  const signers = { borrower, bari: context.actors.bari, kybIssuer: context.actors.kyb_issuer.address };
  try {
    const { result: loan, transactions } = await context.operations.run("sme.loan", () =>
      originateLoan(context.client, context.ledger, signers, state.fund, { tokenId, certificate: invoice.certificate }),
    );
    const record = loanState(loan, borrower.address, "active", new Date().toISOString());
    context.store.update((current) => {
      current.loans.push(record);
    });
    return {
      loanId: loan.loanId,
      tokenId,
      checks: loan.checks,
      principal: loan.terms.principal.toString(),
      originationFee: loan.terms.originationFee.toString(),
      netAdvance: loan.terms.netAdvance.toString(),
      dueDate: rippleTimeToISOTime(loan.maturity),
      txHash: loan.hash,
      transactions,
    };
  } catch (error) {
    if (error instanceof OperationFailed && error.original instanceof LoanRefused) {
      throw new HttpError(HTTP_UNPROCESSABLE, error.message, { checks: error.original.checks, transactions: error.transactions });
    }
    throw error;
  }
}

function businessInvoices(context: ApiContext, account: string): BusinessInvoice[] {
  const state = context.store.current;
  if (state === undefined) return [];
  return state.invoices
    .filter((invoice) => invoice.owner === account)
    .map((invoice) => {
      const loan = state.loans.find((candidate) => candidate.reference.invoiceTokenId === invoice.tokenId);
      return {
        tokenId: invoice.tokenId,
        nullifier: invoice.certificate.nullifier,
        status: loan?.status ?? "certified",
        issuedAt: invoice.issuedAt,
        certificateTxHash: invoice.txHash,
        loanId: loan?.loanId,
        loanTxHash: loan?.txHash,
        principal: loan?.principal,
        originationFee: loan?.originationFee,
        dueDate: loan?.dueDate,
      };
    });
}

export function registerSmeRoutes(app: FastifyInstance, context: ApiContext): void {
  const businessOnly = requireRole(context, "business");

  app.get<{ Params: AccountParams }>("/api/sme/kyb/:account", { schema: accountParamsSchema }, async (request): Promise<KybStatus> => {
    const account = requireAddress(request.params.account);
    return { account, done: await isSmeKybDone(context.ledger, account, context.actors.kyb_issuer.address) };
  });

  app.get<{ Params: RegistryParams; Querystring: RegistryQuery }>(
    "/api/registry/:nullifier",
    { schema: registrySchema },
    async (request): Promise<RegistryLookup> => {
      const registration = await getRegistration(
        context.ledger,
        context.actors.bari_registry.address,
        requireAddress(request.query.account),
        request.params.nullifier.toUpperCase(),
      );
      return registration === undefined ? { registered: false } : { registered: true, txHash: registration.PreviousTxnID };
    },
  );

  app.get<{ Querystring: OfferQuery }>("/api/offer", { schema: offerSchema }, async (request): Promise<OfferSchedule> => {
    const dueDate = Date.parse(request.query.dueDate) / MS_PER_SECOND;
    const now = Date.now() / MS_PER_SECOND;
    if (Number.isNaN(dueDate) || dueDate <= now) throw new HttpError(HTTP_BAD_REQUEST, "The due date must be a future ISO date");
    const redemptionDate = context.store.current?.fund.cohort.redemptionDate;
    const latestMaturity =
      redemptionDate === undefined ? undefined : rippleTimeToUnixTime(latestLoanMaturity(redemptionDate)) / MS_PER_SECOND;
    const offer = fundOffer({ dueDate, now, latestMaturity });
    if (offer === undefined) throw new HttpError(HTTP_UNPROCESSABLE, "The fund redeems too soon to finance this invoice");
    return offer;
  });

  app.post<{ Body: CertificateBody }>(
    "/api/sme/certificate",
    { schema: certificateSchema, preHandler: businessOnly },
    async (request, reply) => {
      const sme = businessWallet(request);
      const certificate = await certificateFromProof(request.body, proofExpectations(context, sme.address));
      return reply.status(HTTP_CREATED).send(await issue(context, sme, certificate));
    },
  );

  app.post<{ Body: LoanBody }>("/api/sme/loan", { schema: loanSchema, preHandler: businessOnly }, async (request, reply) => {
    const loan = await lend(context, businessWallet(request), request.body.tokenId.toUpperCase());
    return reply.status(HTTP_CREATED).send(loan);
  });

  app.get("/api/business/invoices", { preHandler: businessOnly }, async (request): Promise<BusinessInvoice[]> => {
    const account = sessionUser(request, "business").account?.address;
    return account === undefined ? [] : businessInvoices(context, account);
  });
}
