// Côté PME : KYB, certificat (preuve du navigateur ou, en secours, calculée par le serveur), puis prêt co-signé.

import type { FastifyInstance } from "fastify";
import type { InvoiceCertificate } from "../../../invoice/certificate.js";
import { issueCertificate } from "../../../invoice/issueCertificate.js";
import { onboardSme } from "../../../kyb/smeKyb.js";
import { originateLoan } from "../../../lending/loan.js";
import { prove } from "../../../zk/index.js";
import { parseAttestedInvoice } from "../../attestedInvoice.js";
import { certificateFromProof } from "../certificateFromProof.js";
import { proofExpectations, requireFund, type ApiContext } from "../context.js";
import { HttpError } from "../errors.js";
import { attestedInvoiceSchema, certificateSchema, loanSchema, type CertificateBody, type LoanBody } from "../schemas.js";
import { buildProveInput } from "../zkInputs.js";

const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_CREATED = 201;
const DUPLICATE_RESULT = "tecDUPLICATE";

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
  app.post("/api/sme/kyb", async () => {
    const { transactions } = await context.operations.run("sme.kyb", () => onboardSme(context.client, context.actors));
    return { account: context.actors.sme.address, done: true, transactions };
  });

  app.post<{ Body: CertificateBody }>("/api/sme/certificate", { schema: certificateSchema }, async (request, reply) => {
    const certificate = await certificateFromProof(request.body, proofExpectations(context));
    return reply.status(HTTP_CREATED).send(await issue(context, certificate));
  });

  app.post("/api/sme/certificate/server-proof", { schema: attestedInvoiceSchema }, async (request, reply) => {
    const expectations = proofExpectations(context);
    const proven = await prove(await buildProveInput(parseAttestedInvoice(request.body), expectations));
    const certificate = await certificateFromProof(proven, expectations);
    const issued = await issue(context, certificate);
    // Ouverture de l'engagement C : à garder par la PME pour un éventuel litige, jamais publiée.
    const opening = { message: proven.opening.message.toString(), blinding: proven.opening.blinding.toString() };
    return reply.status(HTTP_CREATED).send({ ...issued, opening });
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
