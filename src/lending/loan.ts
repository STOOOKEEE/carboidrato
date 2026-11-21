// Prêt adossé au certificat : contrôles de Bari, puis LoanSet signé par l'entreprise emprunteuse et co-signé par Bari.
// Le prêt suit toujours le certificat (enregistrer d'abord, prêter ensuite : IDEE §6).

import { signLoanSetByCounterparty, unixTimeToRippleTime, type Client, type LoanSet, type Wallet } from "xrpl";
import { LEDGER_MIN_GRACE_PERIOD_S } from "../config/cohort.js";
import { INTEREST_RATE_PERCENT, LATE_INTEREST_RATE_PERCENT } from "../config/finance.js";
import type { Fund } from "../fund/fund.js";
import { encodeLoanData, type LoanReference } from "../fund/loanData.js";
import type { IssuedCertificate } from "../invoice/issueCertificate.js";
import { formatRlusd } from "../lib/amounts.js";
import { log } from "../lib/logger.js";
import { percentToTenthBips } from "../lib/rates.js";
import type { Ledger } from "../xrpl/ledger.js";
import { waitForLedgerTimeAfter } from "../xrpl/ledgerTime.js";
import { createdLedgerIndex } from "../xrpl/meta.js";
import { unitsToValue } from "../xrpl/stablecoin.js";
import { submitSignedBlob } from "../xrpl/submit.js";
import { refusalReason, reviewLoan, type LoanCheck } from "./loanChecks.js";
import { loanPaymentInterval, type LoanTerms } from "./loanTerms.js";

/** Un LoanSet paie une signature de plus : celle de la contrepartie (Bari). */
const LOAN_SET_SIGNATURE_COUNT = 2n;
const MS_PER_SECOND = 1_000;

/** Signataires du LoanSet : l'entreprise emprunteuse, Bari (contrepartie) ; le KYB est lu chez son émetteur. */
export interface LoanSigners {
  borrower: Wallet;
  bari: Wallet;
  kybIssuer: string;
}

export interface OriginatedLoan {
  loanId: string;
  reference: LoanReference;
  /** Hash du LoanSet co-signé. */
  hash: string;
  checks: LoanCheck[];
  terms: LoanTerms;
  /** Échéance du prêt, en temps Ripple. */
  maturity: number;
}

/** Bari refuse de co-signer : tous les contrôles, le premier en échec donnant la raison. */
export class LoanRefused extends Error {
  constructor(readonly checks: LoanCheck[]) {
    super(`Bari refuses to co-sign: ${refusalReason(checks) ?? "a check failed"}`);
  }
}

/** Fixé ici plutôt que par autofill, qui l'estime de la même façon mais affiche un avertissement. */
async function loanSetFee(client: Client): Promise<string> {
  const { result } = await client.request({ command: "fee" });
  return (BigInt(result.drops.open_ledger_fee) * LOAN_SET_SIGNATURE_COUNT).toString();
}

/** LoanSet à échéance unique, sans frais réseau ; principal et frais de dossier en valeur RLUSD du ledger. */
export function loanSetTransaction(
  borrower: string,
  brokerId: string,
  terms: LoanTerms,
  reference: LoanReference,
  interval: number,
): LoanSet {
  return {
    TransactionType: "LoanSet",
    Account: borrower,
    LoanBrokerID: brokerId,
    PrincipalRequested: unitsToValue(terms.principal),
    LoanOriginationFee: unitsToValue(terms.originationFee),
    InterestRate: percentToTenthBips(INTEREST_RATE_PERCENT),
    LateInterestRate: percentToTenthBips(LATE_INTEREST_RATE_PERCENT),
    PaymentTotal: 1,
    PaymentInterval: interval,
    GracePeriod: LEDGER_MIN_GRACE_PERIOD_S,
    Data: encodeLoanData(reference),
  };
}

/** Lectures par `ledger` (contrôles, heure), signature et soumission par `client`. */
export async function originateLoan(
  client: Client,
  ledger: Ledger,
  signers: LoanSigners,
  fund: Fund,
  issued: IssuedCertificate,
): Promise<OriginatedLoan> {
  const { borrower, bari } = signers;
  if ((await ledger.closeTime()) <= fund.cohort.subscriptionDate) {
    await waitForLedgerTimeAfter(client, fund.cohort.subscriptionDate, "fin de la phase de souscription");
  }
  const reference: LoanReference = {
    nullifier: issued.certificate.nullifier,
    invoiceTokenId: issued.tokenId,
    pseudonym: issued.certificate.pseudonym,
  };
  const review = await reviewLoan(ledger, { borrower: borrower.address, bari: bari.address, kybIssuer: signers.kybIssuer }, fund, reference);
  if (review.approval === undefined) throw new LoanRefused(review.checks);
  const { certificate, terms } = review.approval;

  const now = await ledger.closeTime();
  const interval = loanPaymentInterval({
    now,
    invoiceDueDate: unixTimeToRippleTime(certificate.dueDate * MS_PER_SECOND),
    redemptionDate: fund.cohort.redemptionDate,
  });
  const loanSet: LoanSet = {
    ...loanSetTransaction(borrower.address, fund.brokerId, terms, reference, interval),
    Fee: await loanSetFee(client),
  };
  const balanceBefore = await ledger.stablecoinBalance(fund.stablecoin, borrower.address);
  // L'entreprise (emprunteuse) signe en premier, Bari (propriétaire du broker) co-signe.
  const prepared = await client.autofill(loanSet);
  const borrowerSigned = borrower.sign(prepared);
  const { tx_blob, hash } = signLoanSetByCounterparty(bari, borrowerSigned.tx_blob);
  const outcome = await submitSignedBlob(
    client,
    tx_blob,
    hash,
    `LoanSet ${formatRlusd(terms.principal, 2)}, frais ${formatRlusd(terms.originationFee, 2)} (${interval} s)`,
  );
  const loanId = createdLedgerIndex(outcome.meta, "Loan");
  const received = (await ledger.stablecoinBalance(fund.stablecoin, borrower.address)) - balanceBefore;
  log.info(`Loan ${loanId}`);
  log.info(`Data = N ‖ ID du MPT facture ‖ P : ${loanSet.Data}`);
  if (received !== terms.netAdvance) {
    throw new Error(`L'emprunteur a reçu ${formatRlusd(received)} au lieu de ${formatRlusd(terms.netAdvance)}`);
  }
  log.info(`l'emprunteur reçoit ${formatRlusd(received, 2)} (principal − frais de dossier)`);
  return { loanId, reference, hash: outcome.hash, checks: review.checks, terms, maturity: now + interval };
}
