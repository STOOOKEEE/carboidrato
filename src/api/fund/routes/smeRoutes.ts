// Côté entreprise : lectures publiques du pré-contrôle (registre de N, KYB, barème de l'offre), puis certificat à partir
// d'une preuve calculée dans le navigateur, prêt co-signé et factures du compte. Compte géré : Bari signe pour
// l'entreprise ; wallet (Otsu) : Bari prépare chaque transaction, l'entreprise la signe, Bari soumet le blob exact.

import type { FastifyInstance } from "fastify";
import { hashes, isValidClassicAddress, rippleTimeToISOTime, rippleTimeToUnixTime, Wallet, type LoanSet } from "xrpl";
import type { UserRecord } from "../../../accounts/userStore.js";
import type { InvoiceCertificate } from "../../../invoice/certificate.js";
import {
  CERTIFICATE_BATCH_LABEL,
  issueCertificate,
  prepareCertificateBatch,
  settleCertificateBatch,
  type IssuedCertificate,
  type PreparedCertificate,
} from "../../../invoice/issueCertificate.js";
import { getRegistration } from "../../../invoice/registry.js";
import { isSmeKybDone } from "../../../kyb/smeKyb.js";
import { formatRlusd } from "../../../lib/amounts.js";
import {
  counterSignLoan,
  LoanRefused,
  originateLoan,
  prepareLoanSet,
  proposeLoan,
  type LoanProposal,
  type OriginatedLoan,
} from "../../../lending/loan.js";
import { reviewLoan } from "../../../lending/loanChecks.js";
import { latestLoanMaturity } from "../../../lending/loanTerms.js";
import { PreparedStore, type WalletTxPorts } from "../../../xrpl/preparedTx.js";
import type {
  BusinessInvoice,
  CertificateResponse,
  KybStatus,
  LoanResponse,
  LoanSignature,
  OfferSchedule,
  OnboardingSubmitRequest,
  PreparedSignature,
  RegistryLookup,
} from "../../contract.js";
import { fundOffer } from "../../offer.js";
import { requireRole, sessionUser } from "../auth.js";
import { certificateFromProof } from "../certificateFromProof.js";
import { proofExpectations, requireFund, type ApiContext } from "../context.js";
import { HttpError } from "../errors.js";
import type { TxSummary } from "../events.js";
import { OperationFailed } from "../operations.js";
import {
  accountParamsSchema,
  certificateSchema,
  loanSchema,
  offerSchema,
  onboardingSubmitSchema,
  registrySchema,
  type AccountParams,
  type CertificateBody,
  type LoanBody,
  type OfferQuery,
  type RegistryParams,
  type RegistryQuery,
} from "../schemas.js";
import { loanState } from "../stateStore.js";
import { signatureRequest, submitBeforeExpiry, takeSigned } from "../walletSignature.js";

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_UNPROCESSABLE = 422;
const HTTP_CREATED = 201;
const DUPLICATE_RESULT = "tecDUPLICATE";
const MS_PER_SECOND = 1_000;
const DUPLICATE_MESSAGE = "Invoice already registered: the ledger refuses double financing";
/** Ce que signe l'entreprise dans Otsu, dans l'ordre des transactions internes du Batch. */
const CERTIFICATE_STEPS = [
  "Register the invoice fingerprint",
  "Create the invoice token with its proof",
  "Bari accepts the invoice token (signed by Bari)",
  "Hand the invoice token to Bari",
];

type Business = Extract<UserRecord, { role: "business" }>;

/** Batch du certificat en attente de la signature de l'entreprise. */
interface PendingCertificate {
  tx: PreparedCertificate["batch"];
  prepared: PreparedCertificate;
  certificate: InvoiceCertificate;
}

/** LoanSet en attente de la signature de l'entreprise, que Bari co-signera. */
interface PendingLoan {
  tx: LoanSet;
  proposal: LoanProposal;
  tokenId: string;
}

function requireAddress(account: string): string {
  if (!isValidClassicAddress(account)) throw new HttpError(HTTP_BAD_REQUEST, "Invalid XRPL address");
  return account;
}

/** Compte XRPL de l'entreprise : son wallet, ou le compte que Bari gère pour elle. */
function businessAccount(user: Business): string | undefined {
  return user.custody === "wallet" ? user.address : user.account?.address;
}

function requireBusinessAccount(user: Business): string {
  const account = businessAccount(user);
  if (account === undefined) throw new HttpError(HTTP_CONFLICT, "This business has no XRPL account yet");
  return account;
}

/** Compte XRPL géré de l'entreprise de la session : Bari signe pour elle, la seed ne sort jamais de l'API. */
function managedWallet(user: Business): Wallet {
  if (user.account === undefined) throw new HttpError(HTTP_CONFLICT, "This business has no XRPL account yet");
  return Wallet.fromSeed(user.account.seed);
}

function duplicateError(certificate: InvoiceCertificate, transactions: TxSummary[], rejectedBy?: TxSummary): HttpError {
  return new HttpError(HTTP_CONFLICT, DUPLICATE_MESSAGE, {
    nullifier: certificate.nullifier,
    hash: rejectedBy?.hash,
    explorerUrl: rejectedBy?.explorerUrl,
    rejectedBy,
    transactions,
  });
}

/** Certificat émis par le Batch `batchHash` : enregistré pour son propriétaire, même réponse quel que soit le signataire. */
function recordCertificate(
  context: ApiContext,
  owner: string,
  issued: IssuedCertificate,
  batchHash: string | undefined,
  transactions: TxSummary[],
): CertificateResponse {
  const { certificate } = issued;
  context.store.update((state) => {
    state.invoices.push({ tokenId: issued.tokenId, certificate, issuedAt: new Date().toISOString(), owner, txHash: batchHash });
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

/** Enregistrement de N → MPT facture → remise à Bari. 409 si N est déjà enregistré (refinancement refusé). */
async function issue(context: ApiContext, sme: Wallet, certificate: InvoiceCertificate): Promise<CertificateResponse> {
  requireFund(context);
  const { actors, client } = context;
  const { result: issued, transactions } = await context.operations.run("sme.certificate", () =>
    issueCertificate(client, { sme, bari: actors.bari, registry: actors.bari_registry.address }, certificate),
  );
  if (issued === undefined) {
    // Séquentiel : le CredentialCreate en tecDUPLICATE ; Batch : le Batch validé dont rien n'a été appliqué.
    throw duplicateError(certificate, transactions, transactions.find((tx) => tx.result === DUPLICATE_RESULT) ?? transactions[0]);
  }
  // La première transaction de l'opération est le Batch du certificat.
  return recordCertificate(context, sme.address, issued, transactions[0]?.hash, transactions);
}

/** Facture du compte, avec son certificat : 404 si elle appartient à un autre compte. */
function ownInvoice(context: ApiContext, account: string, tokenId: string) {
  const state = requireFund(context);
  const invoice = state.invoices.find((candidate) => candidate.tokenId === tokenId && candidate.owner === account);
  if (invoice === undefined) throw new HttpError(HTTP_NOT_FOUND, `Unknown invoice token for this account: ${tokenId}`);
  return { state, invoice };
}

/** Refus de Bari en 422 avec la liste des contrôles ; toute autre erreur telle quelle. */
function asRefusal(error: unknown): unknown {
  if (error instanceof OperationFailed && error.original instanceof LoanRefused) {
    return new HttpError(HTTP_UNPROCESSABLE, error.message, { checks: error.original.checks, transactions: error.transactions });
  }
  if (error instanceof LoanRefused) return new HttpError(HTTP_UNPROCESSABLE, error.message, { checks: error.checks, transactions: [] });
  return error;
}

/** Prêt accordé : enregistré pour l'emprunteur, réponse identique quel que soit le signataire. */
function recordLoan(context: ApiContext, borrower: string, tokenId: string, loan: OriginatedLoan, transactions: TxSummary[]): LoanResponse {
  const record = loanState(loan, borrower, "active", new Date().toISOString());
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
}

/** Contrôles puis LoanSet co-signé ; un refus de Bari devient un 422 avec la liste des contrôles. */
async function lend(context: ApiContext, borrower: Wallet, tokenId: string): Promise<LoanResponse> {
  const { state, invoice } = ownInvoice(context, borrower.address, tokenId);
  const signers = { borrower, bari: context.actors.bari, kybIssuer: context.actors.kyb_issuer.address };
  try {
    const { result: loan, transactions } = await context.operations.run("sme.loan", () =>
      originateLoan(context.client, context.ledger, signers, state.fund, { tokenId, certificate: invoice.certificate }),
    );
    return recordLoan(context, borrower.address, tokenId, loan, transactions);
  } catch (error) {
    throw asRefusal(error);
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

/** Certificat et prêt d'une entreprise qui signe dans son wallet : Bari prépare, l'entreprise signe, Bari soumet. */
function walletBusiness(context: ApiContext, ports: WalletTxPorts) {
  // En mémoire : un redémarrage oblige seulement à recommencer.
  const certificates = new PreparedStore<PendingCertificate>();
  const loans = new PreparedStore<PendingLoan>();
  const submitter = submitBeforeExpiry(ports);
  const { bari, bari_registry: registry, kyb_issuer: kybIssuer } = context.actors;

  return {
    /** 409 dès la préparation si N est déjà enregistré : l'entreprise ne signe pas un Batch voué à l'échec. */
    async prepareCertificate(user: Business, sme: string, certificate: InvoiceCertificate): Promise<PreparedSignature> {
      requireFund(context);
      const registration = await getRegistration(context.ledger, registry.address, sme, certificate.nullifier);
      if (registration !== undefined) {
        throw new HttpError(HTTP_CONFLICT, DUPLICATE_MESSAGE, {
          nullifier: certificate.nullifier,
          hash: registration.PreviousTxnID,
          transactions: [],
        });
      }
      const prepared = await prepareCertificateBatch(ports, { sme, bari, registry: registry.address }, certificate);
      certificates.set(user.id, { tx: prepared.batch, prepared, certificate });
      return signatureRequest(prepared.batch, CERTIFICATE_STEPS);
    },

    async submitCertificate(user: Business, sme: string, txBlob: string): Promise<CertificateResponse> {
      const { prepared, certificate } = takeSigned(certificates, user.id, txBlob);
      // La transaction interne de Bari porte sa séquence d'alors : si Bari a signé autre chose depuis, rien ne passerait.
      const bariTx = prepared.inner.find(({ tx }) => tx.Account === bari.address);
      if (bariTx?.tx.Sequence !== (await ports.accountState(bari.address)).sequence) {
        throw new HttpError(HTTP_CONFLICT, "Bari's part of this request is out of date. Start again.");
      }
      const batchHash = hashes.hashSignedTx(txBlob);
      const { result: issued, transactions } = await context.operations.run("sme.certificate", async () => {
        const outcome = await submitter.submitSigned(txBlob, batchHash, CERTIFICATE_BATCH_LABEL);
        return settleCertificateBatch(context.ledger, prepared, outcome, certificate);
      });
      if (issued === undefined) {
        const registered = await getRegistration(context.ledger, registry.address, sme, certificate.nullifier);
        if (registered !== undefined) {
          throw duplicateError(certificate, transactions, transactions.find(({ hash }) => hash === batchHash));
        }
        throw new HttpError(HTTP_CONFLICT, "The ledger did not record the certificate. Start again.", { transactions });
      }
      return recordCertificate(context, sme, issued, batchHash, transactions);
    },

    /** Contrôles de Bari d'abord : l'entreprise ne signe que le LoanSet que Bari est prêt à co-signer. */
    async prepareLoan(user: Business, borrower: string, tokenId: string): Promise<LoanSignature> {
      const { state, invoice } = ownInvoice(context, borrower, tokenId);
      const parties = { borrower, bari: bari.address, kybIssuer: kybIssuer.address };
      const proposal = await proposeLoan(context.client, context.ledger, parties, state.fund, {
        tokenId,
        certificate: invoice.certificate,
      }).catch((error: unknown) => {
        throw asRefusal(error);
      });
      const loanSet = await prepareLoanSet(ports, proposal);
      loans.set(user.id, { tx: loanSet, proposal, tokenId });
      const { principal, originationFee } = proposal.terms;
      const label = `Borrow ${formatRlusd(principal, 2)} (fee ${formatRlusd(originationFee, 2)}), co-signed by Bari`;
      return { ...signatureRequest(loanSet, [label]), checks: proposal.checks };
    },

    /** Bari refait ses contrôles juste avant de co-signer : le ledger a pu changer pendant la signature. */
    async submitLoan(user: Business, borrower: string, txBlob: string): Promise<LoanResponse> {
      const { proposal, tokenId } = takeSigned(loans, user.id, txBlob);
      const { fund } = requireFund(context);
      const parties = { borrower, bari: bari.address, kybIssuer: kybIssuer.address };
      try {
        const { result: loan, transactions } = await context.operations.run("sme.loan", async () => {
          const review = await reviewLoan(context.ledger, parties, fund, proposal.reference);
          if (review.approval === undefined) throw new LoanRefused(review.checks);
          return counterSignLoan(submitter, context.ledger, bari, fund, proposal, txBlob);
        });
        return recordLoan(context, borrower, tokenId, loan, transactions);
      } catch (error) {
        throw asRefusal(error);
      }
    },
  };
}

export function registerSmeRoutes(app: FastifyInstance, context: ApiContext, ports: WalletTxPorts): void {
  const businessOnly = requireRole(context, "business");
  const wallet = walletBusiness(context, ports);

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
      const user = sessionUser(request, "business");
      const sme = requireBusinessAccount(user);
      const certificate = await certificateFromProof(request.body, proofExpectations(context, sme));
      if (user.custody === "wallet") return wallet.prepareCertificate(user, sme, certificate);
      return reply.status(HTTP_CREATED).send(await issue(context, managedWallet(user), certificate));
    },
  );

  app.post<{ Body: OnboardingSubmitRequest }>(
    "/api/sme/certificate/submit",
    { schema: onboardingSubmitSchema, preHandler: businessOnly },
    async (request, reply) => {
      const user = sessionUser(request, "business");
      const response = await wallet.submitCertificate(user, requireBusinessAccount(user), request.body.tx_blob);
      return reply.status(HTTP_CREATED).send(response);
    },
  );

  app.post<{ Body: LoanBody }>("/api/sme/loan", { schema: loanSchema, preHandler: businessOnly }, async (request, reply) => {
    const user = sessionUser(request, "business");
    const tokenId = request.body.tokenId.toUpperCase();
    if (user.custody === "wallet") return wallet.prepareLoan(user, requireBusinessAccount(user), tokenId);
    return reply.status(HTTP_CREATED).send(await lend(context, managedWallet(user), tokenId));
  });

  app.post<{ Body: OnboardingSubmitRequest }>(
    "/api/sme/loan/submit",
    { schema: onboardingSubmitSchema, preHandler: businessOnly },
    async (request, reply) => {
      const user = sessionUser(request, "business");
      const response = await wallet.submitLoan(user, requireBusinessAccount(user), request.body.tx_blob);
      return reply.status(HTTP_CREATED).send(response);
    },
  );

  app.get("/api/business/invoices", { preHandler: businessOnly }, async (request): Promise<BusinessInvoice[]> => {
    const account = businessAccount(sessionUser(request, "business"));
    return account === undefined ? [] : businessInvoices(context, account);
  });
}
