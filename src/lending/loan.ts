// Prêt adossé au certificat : contrôles de Bari, puis LoanSet signé par la PME et co-signé par Bari.
// Le prêt suit toujours le certificat (enregistrer d'abord, prêter ensuite : IDEE §6).

import { signLoanSetByCounterparty, type Client, type LoanSet } from "xrpl";
import type { Actors } from "../accounts/actors.js";
import {
  LEDGER_LOAN_REDEMPTION_BUFFER_S,
  LEDGER_MIN_GRACE_PERIOD_S,
  LEDGER_MIN_PAYMENT_INTERVAL_S,
  LEDGER_TIME_SAFETY_MARGIN_S,
} from "../config/cohort.js";
import { INTEREST_RATE_PERCENT, LATE_INTEREST_RATE_PERCENT } from "../config/finance.js";
import type { IssuedCertificate } from "../invoice/issueCertificate.js";
import { formatEur } from "../lib/amounts.js";
import { log } from "../lib/logger.js";
import { percentToTenthBips } from "../lib/rates.js";
import type { Fund } from "../setup/fundSetup.js";
import { getMptBalance } from "../xrpl/ledgerEntries.js";
import { ledgerTime, waitForLedgerTimeAfter } from "../xrpl/ledgerTime.js";
import { createdLedgerIndex } from "../xrpl/meta.js";
import { submitSignedBlob } from "../xrpl/submit.js";
import { verifyBeforeCosigning } from "./loanChecks.js";
import { encodeLoanData, type LoanReference } from "./loanData.js";
import { loanTerms } from "./loanTerms.js";

/** Un LoanSet paie une signature de plus : celle de la contrepartie (Bari). */
const LOAN_SET_SIGNATURE_COUNT = 2n;

export interface OriginatedLoan {
  loanId: string;
  reference: LoanReference;
}

/** Fixé ici plutôt que par autofill, qui l'estime de la même façon mais affiche un avertissement. */
async function loanSetFee(client: Client): Promise<string> {
  const { result } = await client.request({ command: "fee" });
  return (BigInt(result.drops.open_ledger_fee) * LOAN_SET_SIGNATURE_COUNT).toString();
}

/** Intervalle unique tel que l'échéance tombe ≥ 60 s avant RedemptionDate (contrainte du ledger). */
async function paymentIntervalBeforeRedemption(client: Client, redemptionDate: number): Promise<number> {
  const interval =
    redemptionDate - (await ledgerTime(client)) - LEDGER_LOAN_REDEMPTION_BUFFER_S - LEDGER_TIME_SAFETY_MARGIN_S;
  if (interval < LEDGER_MIN_PAYMENT_INTERVAL_S) {
    throw new Error(`Phase d'investissement trop courte (intervalle ${interval} s) : augmenter COHORT_INVESTMENT_S`);
  }
  return interval;
}

export async function originateLoan(
  client: Client,
  actors: Actors,
  fund: Fund,
  issued: IssuedCertificate,
): Promise<OriginatedLoan> {
  await waitForLedgerTimeAfter(client, fund.cohort.subscriptionDate, "fin de la phase de souscription");
  const terms = loanTerms();
  const reference: LoanReference = {
    nullifier: issued.certificate.nullifier,
    invoiceTokenId: issued.tokenId,
    pseudonym: issued.certificate.pseudonym,
  };
  await verifyBeforeCosigning(client, actors, fund, reference, terms.principal);

  const interval = await paymentIntervalBeforeRedemption(client, fund.cohort.redemptionDate);
  const loanSet: LoanSet = {
    TransactionType: "LoanSet",
    Account: actors.sme.address,
    LoanBrokerID: fund.brokerId,
    PrincipalRequested: terms.principal.toString(),
    LoanOriginationFee: terms.originationFee.toString(),
    InterestRate: percentToTenthBips(INTEREST_RATE_PERCENT),
    LateInterestRate: percentToTenthBips(LATE_INTEREST_RATE_PERCENT),
    PaymentTotal: 1,
    PaymentInterval: interval,
    GracePeriod: LEDGER_MIN_GRACE_PERIOD_S,
    Data: encodeLoanData(reference),
    Fee: await loanSetFee(client),
  };
  const balanceBefore = await getMptBalance(client, fund.assetId, actors.sme.address);
  // La PME (emprunteuse) signe en premier, Bari (propriétaire du broker) co-signe.
  const prepared = await client.autofill(loanSet);
  const smeSigned = actors.sme.sign(prepared);
  const { tx_blob, hash } = signLoanSetByCounterparty(actors.bari, smeSigned.tx_blob);
  const outcome = await submitSignedBlob(
    client,
    tx_blob,
    hash,
    `LoanSet ${formatEur(terms.principal, 2)}, frais ${formatEur(terms.originationFee, 2)} (${interval} s)`,
  );
  const loanId = createdLedgerIndex(outcome.meta, "Loan");
  const received = (await getMptBalance(client, fund.assetId, actors.sme.address)) - balanceBefore;
  log.info(`Loan ${loanId}`);
  log.info(`Data = N ‖ ID du MPT facture ‖ P : ${loanSet.Data}`);
  if (received !== terms.netAdvance) {
    throw new Error(`La PME a reçu ${formatEur(received)} au lieu de ${formatEur(terms.netAdvance)}`);
  }
  log.info(`la PME reçoit ${formatEur(received, 2)} (principal − frais de dossier)`);
  return { loanId, reference };
}
