// Prêt adossé au certificat : contrôles de Bari, puis LoanSet signé par l'entreprise emprunteuse et co-signé par Bari.
// Le prêt suit toujours le certificat (enregistrer d'abord, prêter ensuite : IDEE §6). Compte géré : Bari signe pour
// l'entreprise ; wallet : Bari prépare le LoanSet, l'entreprise le signe dans son wallet, Bari co-signe ce blob.

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
import { clientWalletTxPorts, SIGNING_WINDOW_LEDGERS, type WalletTxPorts } from "../xrpl/preparedTx.js";
import { unitsToValue } from "../xrpl/stablecoin.js";
import { refusalReason, reviewLoan, type LoanCheck, type LoanParties } from "./loanChecks.js";
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

/** Prêt accepté par les contrôles de Bari : le LoanSet à faire signer par l'emprunteur, sans séquence ni frais. */
export interface LoanProposal {
  loanSet: LoanSet;
  reference: LoanReference;
  checks: LoanCheck[];
  terms: LoanTerms;
  /** Durée du prêt (s) jusqu'à son échéance unique. */
  interval: number;
  /** Échéance du prêt, en temps Ripple. */
  maturity: number;
}

/** Bari refuse de co-signer : tous les contrôles, le premier en échec donnant la raison. */
export class LoanRefused extends Error {
  constructor(readonly checks: LoanCheck[]) {
    super(`Atlas refuses to co-sign: ${refusalReason(checks) ?? "a check failed"}`);
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

/**
 * Contrôles de Bari (après la phase de souscription) puis LoanSet proposé ; lève `LoanRefused` si un contrôle échoue.
 * Lectures par `ledger` ; `client` sert seulement à attendre la fin de la souscription.
 */
export async function proposeLoan(
  client: Client,
  ledger: Ledger,
  parties: LoanParties,
  fund: Fund,
  issued: IssuedCertificate,
): Promise<LoanProposal> {
  if ((await ledger.closeTime()) <= fund.cohort.subscriptionDate) {
    await waitForLedgerTimeAfter(client, fund.cohort.subscriptionDate, "fin de la phase de souscription");
  }
  const reference: LoanReference = {
    nullifier: issued.certificate.nullifier,
    invoiceTokenId: issued.tokenId,
    pseudonym: issued.certificate.pseudonym,
  };
  const review = await reviewLoan(ledger, parties, fund, reference);
  if (review.approval === undefined) throw new LoanRefused(review.checks);
  const { certificate, terms } = review.approval;

  const now = await ledger.closeTime();
  const interval = loanPaymentInterval({
    now,
    invoiceDueDate: unixTimeToRippleTime(certificate.dueDate * MS_PER_SECOND),
    redemptionDate: fund.cohort.redemptionDate,
  });
  const loanSet = loanSetTransaction(parties.borrower, fund.brokerId, terms, reference, interval);
  return { loanSet, reference, checks: review.checks, terms, interval, maturity: now + interval };
}

/**
 * LoanSet à signer dans le wallet de l'emprunteur : séquence, frais (signature de Bari comprise, comptée par l'autofill)
 * et échéance fixés, pour que le wallet le signe tel quel.
 */
export async function prepareLoanSet(ports: WalletTxPorts, proposal: LoanProposal): Promise<LoanSet> {
  const { sequence, ledgerIndex } = await ports.accountState(proposal.loanSet.Account);
  return ports.autofill({ ...proposal.loanSet, Sequence: sequence, LastLedgerSequence: ledgerIndex + SIGNING_WINDOW_LEDGERS });
}

/** Co-signe par Bari le LoanSet signé par l'emprunteur, le soumet, puis vérifie l'avance nette reçue. */
export async function counterSignLoan(
  ports: Pick<WalletTxPorts, "submitSigned">,
  ledger: Ledger,
  bari: Wallet,
  fund: Fund,
  proposal: LoanProposal,
  borrowerSignedBlob: string,
): Promise<OriginatedLoan> {
  const { loanSet, terms, interval, reference } = proposal;
  const borrower = loanSet.Account;
  const balanceBefore = await ledger.stablecoinBalance(fund.stablecoin, borrower);
  const { tx_blob, hash } = signLoanSetByCounterparty(bari, borrowerSignedBlob);
  const outcome = await ports.submitSigned(
    tx_blob,
    hash,
    `LoanSet ${formatRlusd(terms.principal, 2)}, frais ${formatRlusd(terms.originationFee, 2)} (${interval} s)`,
  );
  const loanId = createdLedgerIndex(outcome.meta, "Loan");
  const received = (await ledger.stablecoinBalance(fund.stablecoin, borrower)) - balanceBefore;
  log.info(`Loan ${loanId}`);
  log.info(`Data = N ‖ ID du MPT facture ‖ P : ${loanSet.Data}`);
  if (received !== terms.netAdvance) {
    throw new Error(`L'emprunteur a reçu ${formatRlusd(received)} au lieu de ${formatRlusd(terms.netAdvance)}`);
  }
  log.info(`l'emprunteur reçoit ${formatRlusd(received, 2)} (principal − frais de dossier)`);
  return { loanId, reference, hash: outcome.hash, checks: proposal.checks, terms, maturity: proposal.maturity };
}

/** Compte géré : lectures par `ledger` (contrôles, heure), signature de l'emprunteur et soumission par `client`. */
export async function originateLoan(
  client: Client,
  ledger: Ledger,
  signers: LoanSigners,
  fund: Fund,
  issued: IssuedCertificate,
): Promise<OriginatedLoan> {
  const { borrower, bari } = signers;
  const parties = { borrower: borrower.address, bari: bari.address, kybIssuer: signers.kybIssuer };
  const proposal = await proposeLoan(client, ledger, parties, fund, issued);
  // L'entreprise (emprunteuse) signe en premier, Bari (propriétaire du broker) co-signe.
  const prepared = await client.autofill({ ...proposal.loanSet, Fee: await loanSetFee(client) });
  const borrowerSigned = borrower.sign(prepared);
  return counterSignLoan(clientWalletTxPorts(client), ledger, bari, fund, proposal, borrowerSigned.tx_blob);
}
