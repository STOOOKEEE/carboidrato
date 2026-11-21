// Prêts en cours : remboursement à l'échéance par l'entreprise emprunteuse, ou défaut (la first-loss de Bari absorbe
// d'abord).

import type { FastifyInstance } from "fastify";
import { Wallet } from "xrpl";
import { defaultLoan } from "../../../lending/defaultFlow.js";
import { repayLoan } from "../../../lending/repayment.js";
import type { SubmitTx } from "../../../xrpl/submit.js";
import { requireFund, type ApiContext } from "../context.js";
import { HttpError } from "../errors.js";
import { fundView } from "../fundView.js";
import { loanParamsSchema, type LoanParams } from "../schemas.js";
import type { LoanState, LoanStatus } from "../stateStore.js";

const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;

function activeLoan(context: ApiContext, id: string): LoanState {
  const loanId = id.toUpperCase();
  const loan = requireFund(context).loans.find((candidate) => candidate.loanId === loanId);
  if (loan === undefined) throw new HttpError(HTTP_NOT_FOUND, `Prêt inconnu de ce fonds : ${loanId}`);
  if (loan.status !== "active") throw new HttpError(HTTP_CONFLICT, `Prêt déjà clos (${loan.status})`);
  return loan;
}

/**
 * Compte qui rembourse : celui de l'entreprise emprunteuse enregistrée avec le prêt, géré par Bari ; la PME de démo
 * pour les prêts de npm run demo:fund (et ceux enregistrés avant les comptes, sans emprunteur).
 */
function borrowerWallet(context: ApiContext, loan: LoanState): Wallet {
  const { sme } = context.actors;
  if (loan.borrower === undefined || loan.borrower === sme.address) return sme;
  const seed = context.users.findBusinessByAccount(loan.borrower)?.account?.seed;
  if (seed === undefined) throw new HttpError(HTTP_CONFLICT, `Emprunteur sans compte géré par Bari : ${loan.borrower}`);
  return Wallet.fromSeed(seed);
}

function markLoan(context: ApiContext, loanId: string, status: LoanStatus): void {
  context.store.update((state) => {
    const loan = state.loans.find((candidate) => candidate.loanId === loanId);
    if (loan !== undefined) loan.status = status;
  });
}

export function registerLoanRoutes(app: FastifyInstance, context: ApiContext, submit: SubmitTx): void {
  app.post<{ Params: LoanParams }>("/api/loans/:id/repay", { schema: loanParamsSchema }, async (request) => {
    const loan = activeLoan(context, request.params.id);
    const state = requireFund(context);
    const parties = { mairie: context.actors.mairie, borrower: borrowerWallet(context, loan), bari: context.actors.bari };
    const { transactions } = await context.operations.run("loan.repay", () =>
      repayLoan(submit, context.ledger, parties, state.fund, loan),
    );
    markLoan(context, loan.loanId, "repaid");
    return { loanId: loan.loanId, status: "repaid", fund: await fundView(context, state), transactions };
  });

  app.post<{ Params: LoanParams }>("/api/loans/:id/default", { schema: loanParamsSchema }, async (request) => {
    const loan = activeLoan(context, request.params.id);
    const state = requireFund(context);
    const { transactions } = await context.operations.run("loan.default", () =>
      defaultLoan(context.client, context.actors, state.fund, loan.loanId),
    );
    markLoan(context, loan.loanId, "defaulted");
    return { loanId: loan.loanId, status: "defaulted", fund: await fundView(context, state), transactions };
  });
}
