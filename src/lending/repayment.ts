// Échéance : la mairie paie l'entreprise, l'entreprise rembourse le prêt, Bari rend le MPT facture (le certificat
// reste on-chain).

import type { Wallet } from "xrpl";
import type { Fund } from "../fund/fund.js";
import { returnInvoiceToken } from "../invoice/invoiceToken.js";
import { formatRlusd } from "../lib/amounts.js";
import { log } from "../lib/logger.js";
import type { Ledger } from "../xrpl/ledger.js";
import { stablecoinAmount, stablecoinPayment, valueToUnits } from "../xrpl/stablecoin.js";
import type { SubmitTx } from "../xrpl/submit.js";
import type { OriginatedLoan } from "./loan.js";
import { loanTerms } from "./loanTerms.js";

/** Signataires du remboursement : le débiteur public, l'entreprise emprunteuse et Bari (qui rend le MPT facture). */
export interface RepaymentParties {
  mairie: Wallet;
  borrower: Wallet;
  bari: Wallet;
}

export async function repayLoan(
  submit: SubmitTx,
  ledger: Ledger,
  { mairie, borrower, bari }: RepaymentParties,
  fund: Fund,
  originated: Pick<OriginatedLoan, "loanId" | "reference">,
): Promise<void> {
  // La mairie règle la facture en RLUSD, au pair de son montant en dollars.
  const { invoice } = loanTerms();
  await submit(
    stablecoinPayment(fund.stablecoin, mairie.address, borrower.address, invoice),
    mairie,
    `Payment RLUSD mairie → sme (${formatRlusd(invoice, 2)})`,
  );

  const loan = await ledger.loan(originated.loanId);
  const due = valueToUnits(loan.TotalValueOutstanding);
  log.info(`dû : ${formatRlusd(due)} (principal ${formatRlusd(valueToUnits(loan.PrincipalOutstanding))})`);
  await submit(
    {
      TransactionType: "LoanPay",
      Account: borrower.address,
      LoanID: originated.loanId,
      Amount: stablecoinAmount(fund.stablecoin, due),
    },
    borrower,
    "LoanPay (remboursement total)",
  );
  // PaymentRemaining est omis du ledger quand il vaut 0.
  const remaining = (await ledger.loan(originated.loanId)).PaymentRemaining ?? 0;
  log.info(`paiements restants sur le prêt : ${remaining}`);

  await returnInvoiceToken(submit, originated.reference.invoiceTokenId, borrower.address, bari);
}
