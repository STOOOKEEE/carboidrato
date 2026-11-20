// Échéance : la mairie paie la PME, la PME rembourse le prêt, Bari rend le MPT facture (le certificat reste on-chain).

import type { Client } from "xrpl";
import type { Actors } from "../accounts/actors.js";
import { returnInvoiceToken } from "../invoice/invoiceToken.js";
import { formatEur, parseUnits } from "../lib/amounts.js";
import { log } from "../lib/logger.js";
import type { Fund } from "../setup/fundSetup.js";
import { getLoan } from "../xrpl/ledgerEntries.js";
import { mptAmount, sendMpt } from "../xrpl/mpt.js";
import { submitTx } from "../xrpl/submit.js";
import type { OriginatedLoan } from "./loan.js";
import { loanTerms } from "./loanTerms.js";

export async function repayLoan(client: Client, actors: Actors, fund: Fund, originated: OriginatedLoan): Promise<void> {
  const { invoice } = loanTerms();
  await sendMpt(client, fund.assetId, actors.mairie, actors.sme.address, invoice, `Payment EURc mairie → sme (${formatEur(invoice, 2)})`);

  const loan = await getLoan(client, originated.loanId);
  const due = parseUnits(loan.TotalValueOutstanding);
  log.info(`dû : ${formatEur(due)} (principal ${formatEur(parseUnits(loan.PrincipalOutstanding))})`);
  await submitTx(
    client,
    {
      TransactionType: "LoanPay",
      Account: actors.sme.address,
      LoanID: originated.loanId,
      Amount: mptAmount(fund.assetId, due),
    },
    actors.sme,
    "LoanPay (remboursement total)",
  );
  // PaymentRemaining est omis du ledger quand il vaut 0.
  const remaining = (await getLoan(client, originated.loanId)).PaymentRemaining ?? 0;
  log.info(`paiements restants sur le prêt : ${remaining}`);

  await returnInvoiceToken(client, originated.reference.invoiceTokenId, actors.sme, actors.bari);
}
