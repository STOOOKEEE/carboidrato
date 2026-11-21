// Prêts en cours : remboursement à l'échéance par l'entreprise emprunteuse, avec sa session. Compte géré : Bari signe
// pour elle ; entreprise wallet : la mairie la paie, Bari prépare son LoanPay, elle le signe dans Otsu, Bari le soumet.

import type { FastifyInstance } from "fastify";
import { hashes, Wallet, type LoanPay } from "xrpl";
import { userAddress, type UserRecord } from "../../../accounts/userStore.js";
import { LOAN_PAY_LABEL, loanPayment, payInvoice, repayLoan, returnCollateral } from "../../../lending/repayment.js";
import { PreparedStore, SIGNING_WINDOW_LEDGERS, type WalletTxPorts } from "../../../xrpl/preparedTx.js";
import type { SubmitTx } from "../../../xrpl/submit.js";
import type { OnboardingSubmitRequest, PreparedSignature } from "../../contract.js";
import { requireRole, sessionUser } from "../auth.js";
import { requireFund, type ApiContext } from "../context.js";
import { HttpError } from "../errors.js";
import { fundView } from "../fundView.js";
import { loanParamsSchema, signedTxSchema, type LoanParams } from "../schemas.js";
import type { LoanState, LoanStatus } from "../stateStore.js";
import { signatureRequest, submitBeforeExpiry, takeSigned } from "../walletSignature.js";

const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;

type Business = Extract<UserRecord, { role: "business" }>;

/** Prêt actif emprunté par l'entreprise de la session : 404 inconnu, 403 d'un autre emprunteur, 409 déjà clos. */
function borrowedLoan(context: ApiContext, id: string, user: Business): LoanState {
  const loanId = id.toUpperCase();
  const loan = requireFund(context).loans.find((candidate) => candidate.loanId === loanId);
  if (loan === undefined) throw new HttpError(HTTP_NOT_FOUND, `Prêt inconnu de ce fonds : ${loanId}`);
  if (loan.borrower === undefined || loan.borrower !== userAddress(user)) {
    throw new HttpError(HTTP_FORBIDDEN, "This loan belongs to another business");
  }
  if (loan.status !== "active") throw new HttpError(HTTP_CONFLICT, `Prêt déjà clos (${loan.status})`);
  return loan;
}

function markLoan(context: ApiContext, loanId: string, status: LoanStatus): void {
  context.store.update((state) => {
    const loan = state.loans.find((candidate) => candidate.loanId === loanId);
    if (loan !== undefined) loan.status = status;
  });
}

export function registerLoanRoutes(app: FastifyInstance, context: ApiContext, submit: SubmitTx, ports: WalletTxPorts): void {
  const businessOnly = requireRole(context, "business");
  // En mémoire, par prêt : le LoanPay qui attend la signature de l'entreprise, et les factures déjà payées par la mairie.
  const repayments = new PreparedStore<{ tx: LoanPay }>();
  const invoicesPaid = new Set<string>();
  const submitter = submitBeforeExpiry(ports);

  /** La mairie paie une seule fois ; le LoanPay du dû est préparé pour le wallet, qui le signe tel quel. */
  async function prepareRepayment(loan: LoanState, borrower: string): Promise<PreparedSignature> {
    const { fund } = requireFund(context);
    const { transactions } = await context.operations.run("loan.repay", async () => {
      if (!invoicesPaid.has(loan.loanId)) {
        await payInvoice(submit, context.actors.mairie, borrower, fund);
        invoicesPaid.add(loan.loanId);
      }
    });
    const { sequence, ledgerIndex } = await ports.accountState(borrower);
    const loanPay = await loanPayment(context.ledger, borrower, fund, loan.loanId);
    const tx = await ports.autofill({ ...loanPay, Sequence: sequence, LastLedgerSequence: ledgerIndex + SIGNING_WINDOW_LEDGERS });
    repayments.set(loan.loanId, { tx });
    return signatureRequest(
      tx,
      ["Repay the loan in RLUSD"],
      transactions.map(({ label, hash }) => ({ label, hash })),
    );
  }

  app.post<{ Params: LoanParams }>("/api/loans/:id/repay", { schema: loanParamsSchema, preHandler: businessOnly }, async (request) => {
    const user = sessionUser(request, "business");
    const loan = borrowedLoan(context, request.params.id, user);
    const state = requireFund(context);
    if (user.custody === "wallet") return prepareRepayment(loan, user.address);
    if (user.account === undefined) throw new HttpError(HTTP_CONFLICT, "This business has no XRPL account yet");
    const parties = { mairie: context.actors.mairie, borrower: Wallet.fromSeed(user.account.seed), bari: context.actors.bari };
    const { transactions } = await context.operations.run("loan.repay", () =>
      repayLoan(submit, context.ledger, parties, state.fund, loan),
    );
    markLoan(context, loan.loanId, "repaid");
    return { loanId: loan.loanId, status: "repaid", fund: await fundView(context, state), transactions };
  });

  app.post<{ Params: LoanParams; Body: OnboardingSubmitRequest }>(
    "/api/loans/:id/repay/submit",
    { schema: { ...loanParamsSchema, ...signedTxSchema }, preHandler: businessOnly },
    async (request) => {
      const user = sessionUser(request, "business");
      const loan = borrowedLoan(context, request.params.id, user);
      const state = requireFund(context);
      if (user.custody !== "wallet") throw new HttpError(HTTP_CONFLICT, "Bari repays this loan for its managed account.");
      const borrower = user.address;
      const txBlob = request.body.tx_blob;
      takeSigned(repayments, loan.loanId, txBlob);
      const { transactions } = await context.operations.run("loan.repay", async () => {
        await submitter.submitSigned(txBlob, hashes.hashSignedTx(txBlob), LOAN_PAY_LABEL);
        await returnCollateral(submit, context.ledger, loan, borrower, context.actors.bari);
      });
      markLoan(context, loan.loanId, "repaid");
      return { loanId: loan.loanId, status: "repaid", fund: await fundView(context, state), transactions };
    },
  );
}
