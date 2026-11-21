// Prêts en cours : remboursement à l'échéance par l'entreprise emprunteuse, ou défaut (la first-loss de Bari absorbe
// d'abord). Entreprise wallet : la mairie la paie, Bari prépare son LoanPay, elle le signe dans Otsu, Bari le soumet.

import type { FastifyInstance } from "fastify";
import { hashes, Wallet, type LoanPay } from "xrpl";
import { defaultLoan } from "../../../lending/defaultFlow.js";
import { LOAN_PAY_LABEL, loanPayment, payInvoice, repayLoan, returnCollateral } from "../../../lending/repayment.js";
import { PreparedStore, SIGNING_WINDOW_LEDGERS, type WalletTxPorts } from "../../../xrpl/preparedTx.js";
import type { SubmitTx } from "../../../xrpl/submit.js";
import type { OnboardingSubmitRequest, PreparedSignature } from "../../contract.js";
import { requireFund, type ApiContext } from "../context.js";
import { HttpError } from "../errors.js";
import { fundView } from "../fundView.js";
import { loanParamsSchema, signedTxSchema, type LoanParams } from "../schemas.js";
import type { LoanState, LoanStatus } from "../stateStore.js";
import { signatureRequest, submitBeforeExpiry, takeSigned } from "../walletSignature.js";

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

/** Emprunteur qui signe dans son wallet (Otsu), undefined pour un compte géré par Bari. */
function walletBorrower(context: ApiContext, loan: LoanState): string | undefined {
  if (loan.borrower === undefined) return undefined;
  const user = context.users.findByAddress(loan.borrower);
  return user?.role === "business" && user.custody === "wallet" ? user.address : undefined;
}

function markLoan(context: ApiContext, loanId: string, status: LoanStatus): void {
  context.store.update((state) => {
    const loan = state.loans.find((candidate) => candidate.loanId === loanId);
    if (loan !== undefined) loan.status = status;
  });
}

export function registerLoanRoutes(app: FastifyInstance, context: ApiContext, submit: SubmitTx, ports: WalletTxPorts): void {
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

  app.post<{ Params: LoanParams }>("/api/loans/:id/repay", { schema: loanParamsSchema }, async (request) => {
    const loan = activeLoan(context, request.params.id);
    const state = requireFund(context);
    const borrower = walletBorrower(context, loan);
    if (borrower !== undefined) return prepareRepayment(loan, borrower);
    const parties = { mairie: context.actors.mairie, borrower: borrowerWallet(context, loan), bari: context.actors.bari };
    const { transactions } = await context.operations.run("loan.repay", () =>
      repayLoan(submit, context.ledger, parties, state.fund, loan),
    );
    markLoan(context, loan.loanId, "repaid");
    return { loanId: loan.loanId, status: "repaid", fund: await fundView(context, state), transactions };
  });

  app.post<{ Params: LoanParams; Body: OnboardingSubmitRequest }>(
    "/api/loans/:id/repay/submit",
    { schema: { ...loanParamsSchema, ...signedTxSchema } },
    async (request) => {
      const loan = activeLoan(context, request.params.id);
      const state = requireFund(context);
      const borrower = walletBorrower(context, loan);
      if (borrower === undefined) throw new HttpError(HTTP_CONFLICT, "Bari repays this loan for its managed account.");
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
