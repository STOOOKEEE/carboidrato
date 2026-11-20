// Côté PME : KYB, lectures publiques du pré-contrôle (registre de N, KYB, offre), certificat à partir d'une preuve
// calculée dans le navigateur, puis prêt co-signé.

import type { FastifyInstance } from "fastify";
import { isValidClassicAddress } from "xrpl";
import type { InvoiceCertificate } from "../../../invoice/certificate.js";
import { issueCertificate } from "../../../invoice/issueCertificate.js";
import { getRegistration } from "../../../invoice/registry.js";
import { isSmeKybDone, onboardSme } from "../../../kyb/smeKyb.js";
import { originateLoan } from "../../../lending/loan.js";
import type { KybRequest, KybResponse, KybStatus, LoanOffer, RegistryLookup } from "../../contract.js";
import { daysUntil, fundOffer } from "../../offer.js";
import { certificateFromProof } from "../certificateFromProof.js";
import { proofExpectations, requireFund, type ApiContext } from "../context.js";
import { HttpError } from "../errors.js";
import {
  accountParamsSchema,
  certificateSchema,
  kybSchema,
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

const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_CREATED = 201;
const DUPLICATE_RESULT = "tecDUPLICATE";
const MS_PER_SECOND = 1_000;

function requireAddress(account: string): string {
  if (!isValidClassicAddress(account)) throw new HttpError(HTTP_BAD_REQUEST, "Invalid XRPL address");
  return account;
}

/** Enregistrement de N → MPT facture → remise à Bari. 409 si N est déjà enregistré (refinancement refusé). */
async function issue(context: ApiContext, certificate: InvoiceCertificate) {
  requireFund(context);
  const { actors, client } = context;
  const { result: issued, transactions } = await context.operations.run("sme.certificate", () =>
    issueCertificate(client, { sme: actors.sme, bari: actors.bari, registry: actors.bari_registry.address }, certificate),
  );
  if (issued === undefined) {
    // Séquentiel : le CredentialCreate en tecDUPLICATE ; Batch : le Batch validé dont rien n'a été appliqué.
    const rejectedBy = transactions.find((tx) => tx.result === DUPLICATE_RESULT) ?? transactions[0];
    throw new HttpError(HTTP_CONFLICT, "Facture déjà enregistrée : double financement refusé par le ledger", {
      nullifier: certificate.nullifier,
      hash: rejectedBy?.hash,
      explorerUrl: rejectedBy?.explorerUrl,
      rejectedBy,
      transactions,
    });
  }
  context.store.update((state) => {
    state.invoices.push({ tokenId: issued.tokenId, certificate, issuedAt: new Date().toISOString() });
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

export function registerSmeRoutes(app: FastifyInstance, context: ApiContext): void {
  app.post<{ Body: KybRequest }>("/api/sme/kyb", { schema: kybSchema }, async (request): Promise<KybResponse> => {
    const account = requireAddress(request.body.account.trim());
    // Seule la PME de la démo a une clé côté serveur pour accepter le credential.
    if (account !== context.actors.sme.address) {
      throw new HttpError(HTTP_FORBIDDEN, "On this demo network, only the demo SME account can be onboarded");
    }
    if (await isSmeKybDone(context.ledger, account, context.actors.kyb_issuer.address)) return { account, done: true };
    const { transactions } = await context.operations.run("sme.kyb", () => onboardSme(context.client, context.actors));
    const txHash = transactions.at(-1)?.hash;
    return { account, done: true, ...(txHash === undefined ? {} : { txHash }) };
  });

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

  app.get<{ Querystring: OfferQuery }>("/api/offer", { schema: offerSchema }, async (request): Promise<LoanOffer> => {
    const dueDate = Date.parse(request.query.dueDate);
    const termDays = Number.isNaN(dueDate) ? 0 : daysUntil(dueDate / MS_PER_SECOND, Date.now() / MS_PER_SECOND);
    if (termDays === 0) throw new HttpError(HTTP_BAD_REQUEST, "The due date must be a future ISO date");
    return fundOffer(termDays);
  });

  app.post<{ Body: CertificateBody }>("/api/sme/certificate", { schema: certificateSchema }, async (request, reply) => {
    const certificate = await certificateFromProof(request.body, proofExpectations(context));
    return reply.status(HTTP_CREATED).send(await issue(context, certificate));
  });

  app.post<{ Body: LoanBody }>("/api/sme/loan", { schema: loanSchema }, async (request, reply) => {
    const state = requireFund(context);
    const tokenId = request.body.tokenId.toUpperCase();
    const invoice = state.invoices.find((candidate) => candidate.tokenId === tokenId);
    if (invoice === undefined) throw new HttpError(HTTP_NOT_FOUND, `MPT facture inconnu de ce fonds : ${tokenId}`);
    if (state.loans.some((loan) => loan.reference.invoiceTokenId === tokenId)) {
      throw new HttpError(HTTP_CONFLICT, "Cette facture est déjà financée");
    }
    const { result: loan, transactions } = await context.operations.run("sme.loan", () =>
      originateLoan(context.client, context.actors, state.fund, { tokenId, certificate: invoice.certificate }),
    );
    context.store.update((current) => {
      current.loans.push({ ...loan, status: "active", createdAt: new Date().toISOString() });
    });
    return reply.status(HTTP_CREATED).send({ loanId: loan.loanId, reference: loan.reference, transactions });
  });
}
