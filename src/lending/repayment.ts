// Échéance : la mairie paie l'entreprise, l'entreprise rembourse le prêt, Bari rend le MPT facture (le certificat
// reste on-chain). Compte géré : Bari signe le LoanPay pour l'entreprise ; wallet : l'entreprise le signe elle-même.

import type { LoanPay, Wallet } from "xrpl";
import type { Fund } from "../fund/fund.js";
import { returnInvoiceToken } from "../invoice/invoiceToken.js";
import { formatRlusd } from "../lib/amounts.js";
import { log } from "../lib/logger.js";
import type { Ledger } from "../xrpl/ledger.js";
import { stablecoinAmount, stablecoinPayment, valueToUnits } from "../xrpl/stablecoin.js";
import type { SubmitTx } from "../xrpl/submit.js";
import type { OriginatedLoan } from "./loan.js";
import { loanTerms } from "./loanTerms.js";

export const LOAN_PAY_LABEL = "LoanPay (remboursement total)";

/** Signataires du remboursement : le débiteur public, l'entreprise emprunteuse et Bari (qui rend le MPT facture). */
export interface RepaymentParties {
  mairie: Wallet;
  borrower: Wallet;
  bari: Wallet;
}

type RepaidLoan = Pick<OriginatedLoan, "loanId" | "reference">;

/** La mairie règle la facture en RLUSD à l'entreprise, au pair de son montant en dollars. */
export async function payInvoice(submit: SubmitTx, mairie: Wallet, borrower: string, fund: Fund): Promise<void> {
  const { invoice } = loanTerms();
  await submit(
    stablecoinPayment(fund.stablecoin, mairie.address, borrower, invoice),
    mairie,
    `Payment RLUSD mairie → sme (${formatRlusd(invoice, 2)})`,
  );
}

/** LoanPay du total dû, lu sur le ledger. */
export async function loanPayment(ledger: Ledger, borrower: string, fund: Fund, loanId: string): Promise<LoanPay> {
  const loan = await ledger.loan(loanId);
  const due = valueToUnits(loan.TotalValueOutstanding);
  log.info(`dû : ${formatRlusd(due)} (principal ${formatRlusd(valueToUnits(loan.PrincipalOutstanding))})`);
  return { TransactionType: "LoanPay", Account: borrower, LoanID: loanId, Amount: stablecoinAmount(fund.stablecoin, due) };
}

/** Prêt remboursé : Bari rend le MPT facture à l'entreprise. */
export async function returnCollateral(submit: SubmitTx, ledger: Ledger, repaid: RepaidLoan, borrower: string, bari: Wallet): Promise<void> {
  // PaymentRemaining est omis du ledger quand il vaut 0.
  const remaining = (await ledger.loan(repaid.loanId)).PaymentRemaining ?? 0;
  log.info(`paiements restants sur le prêt : ${remaining}`);
  await returnInvoiceToken(submit, repaid.reference.invoiceTokenId, borrower, bari);
}

export async function repayLoan(
  submit: SubmitTx,
  ledger: Ledger,
  { mairie, borrower, bari }: RepaymentParties,
  fund: Fund,
  originated: RepaidLoan,
): Promise<void> {
  await payInvoice(submit, mairie, borrower.address, fund);
  await submit(await loanPayment(ledger, borrower.address, fund, originated.loanId), borrower, LOAN_PAY_LABEL);
  await returnCollateral(submit, ledger, originated, borrower.address, bari);
}
