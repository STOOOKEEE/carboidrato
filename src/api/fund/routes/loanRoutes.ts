// Prêts en cours : remboursement à l'échéance, ou défaut (la first-loss de Bari absorbe d'abord).

import type { FastifyInstance } from "fastify";
import { defaultLoan } from "../../../lending/defaultFlow.js";
import { repayLoan } from "../../../lending/repayment.js";
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

function markLoan(context: ApiContext, loanId: string, status: LoanStatus): void {
  context.store.update((state) => {
    const loan = state.loans.find((candidate) => candidate.loanId === loanId);
    if (loan !== undefined) loan.status = status;
  });
}

export function registerLoanRoutes(app: FastifyInstance, context: ApiContext): void {
  app.post<{ Params: LoanParams }>("/api/loans/:id/repay", { schema: loanParamsSchema }, async (request) => {
    const loan = activeLoan(context, request.params.id);
    const state = requireFund(context);
    const { transactions } = await context.operations.run("loan.repay", () =>
      repayLoan(context.client, context.actors, state.fund, loan),
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
