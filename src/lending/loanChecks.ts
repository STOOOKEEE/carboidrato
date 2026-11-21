// Contrôles de Bari avant de co-signer un prêt (IDEE §5 point 4), rendus un par un avec leur raison : KYB, preuve,
// avance, unicité, concentration, échéance. Sur l'AlphaNet, le ledger ne vérifie ni le KYB de l'emprunteur ni le
// certificat : c'est Bari qui refuse de co-signer.

import { unixTimeToRippleTime } from "xrpl";
import { ADVANCE_RATE_PERCENT, MAX_DEBTOR_CONCENTRATION_PERCENT } from "../config/finance.js";
import { concentrationLimit, exposuresByPseudonym } from "../fund/concentration.js";
import type { Fund } from "../fund/fund.js";
import { inspectInvoice } from "../fund/invoiceInspection.js";
import type { LoanReference } from "../fund/loanData.js";
import { listOwnerLoanRecords } from "../fund/loanRecords.js";
import type { CertificateMetadata } from "../invoice/certificateMetadata.js";
import { isSmeKybDone } from "../kyb/smeKyb.js";
import { centsToUnits, formatUsd, formatPercent, formatRlusd, percentOf, ratioPercent, unitsToUsd } from "../lib/amounts.js";
import { log } from "../lib/logger.js";
import type { Ledger } from "../xrpl/ledger.js";
import { valueToUnits } from "../xrpl/stablecoin.js";
import { loanTerms, maturityProblem, OFFER_TIERS_USD, offerTier, type LoanTerms } from "./loanTerms.js";

const MS_PER_SECOND = 1_000;

/** Libellés publics, dans l'ordre où Bari fait les contrôles. */
const LOAN_CHECK_LABELS = {
  kyb: "Business KYB verified",
  proof: "Invoice proof valid",
  advance: `Advance within ${ADVANCE_RATE_PERCENT} % of the proven tier`,
  unique: "Invoice never financed",
  concentration: `Debtor exposure within ${MAX_DEBTOR_CONCENTRATION_PERCENT} % of the fund`,
  maturity: "Loan matures before the fund redemption",
} as const;

export type LoanCheckId = keyof typeof LOAN_CHECK_LABELS;

export interface LoanCheck {
  id: LoanCheckId;
  label: string;
  ok: boolean;
  /** Raison publique d'un échec. */
  reason?: string;
}

/** Comptes en jeu : l'entreprise emprunteuse (compte géré de la session), Bari et le prestataire KYB. */
export interface LoanParties {
  borrower: string;
  bari: string;
  kybIssuer: string;
}

/** Ce que Bari a établi quand tous les contrôles passent : le certificat relu du ledger et les conditions de son palier. */
export interface LoanApproval {
  certificate: CertificateMetadata;
  terms: LoanTerms;
}

export interface LoanReview {
  checks: LoanCheck[];
  approval?: LoanApproval;
}

/** Échec d'un contrôle ; `undefined` s'il passe. */
type Outcome = string | undefined;

const NEEDS_PROOF = "Not checked: the invoice proof is not valid";
const NEEDS_TIER = "Not checked: no proven tier";

const usd = (units: bigint) => `$${unitsToUsd(units).toLocaleString("en-US")}`;

/** Raison du premier contrôle en échec, celle qui explique le refus. */
export function refusalReason(checks: readonly LoanCheck[]): string | undefined {
  return checks.find((check) => !check.ok)?.reason;
}

async function proofOutcome(
  ledger: Ledger,
  parties: LoanParties,
  fund: Fund,
  reference: LoanReference,
): Promise<{ outcome: Outcome; certificate?: CertificateMetadata }> {
  const inspection = await inspectInvoice(ledger, reference, {
    borrower: parties.borrower,
    bari: parties.bari,
    manifest: fund.manifest,
  });
  if (inspection.problems.length > 0) {
    return { outcome: `The invoice certificate does not match the ledger: ${inspection.problems.join("; ")}` };
  }
  if (inspection.certificate === undefined || inspection.proof === undefined) return { outcome: "Unreadable invoice certificate" };
  if (!inspection.heldByBari) return { outcome: "Atlas does not hold the invoice token", certificate: inspection.certificate };
  return { outcome: undefined, certificate: inspection.certificate };
}

/** Avance = taux d'avance × palier prouvé ; elle ne dépasse jamais ce taux appliqué au seuil prouvé. */
function advanceOutcome(certificate: CertificateMetadata): { outcome: Outcome; terms?: LoanTerms } {
  const provenFloor = centsToUnits(certificate.thresholdCents);
  const tier = offerTier(provenFloor);
  if (tier === undefined) {
    return {
      outcome: `Proven threshold ${usd(provenFloor)} is below the smallest tier ($${OFFER_TIERS_USD[0].toLocaleString("en-US")})`,
    };
  }
  const terms = loanTerms(tier);
  const ceiling = percentOf(provenFloor, ADVANCE_RATE_PERCENT);
  if (terms.principal > ceiling) {
    return { outcome: `Advance ${usd(terms.principal)} exceeds ${ADVANCE_RATE_PERCENT} % of the proven threshold ${usd(provenFloor)}` };
  }
  return { outcome: undefined, terms };
}

/**
 * Vérifie, pour le compte emprunteur, le KYB, le certificat (preuve liée à ce compte, MPT facture remis à Bari), l'avance
 * adossée au palier prouvé, l'unicité de N parmi les prêts de tous les fonds de Bari, le plafond par pseudonyme P et
 * l'échéance. Tous les contrôles sont rendus ; `approval` n'est présent que si aucun n'échoue.
 */
export async function reviewLoan(ledger: Ledger, parties: LoanParties, fund: Fund, reference: LoanReference): Promise<LoanReview> {
  const outcomes = {} as Record<LoanCheckId, Outcome>;

  outcomes.kyb = (await isSmeKybDone(ledger, parties.borrower, parties.kybIssuer))
    ? undefined
    : "KYB_PME credential missing or not accepted on this account";

  const proof = await proofOutcome(ledger, parties, fund, reference);
  outcomes.proof = proof.outcome;
  const { certificate } = proof;

  const advance = certificate === undefined ? { outcome: NEEDS_PROOF } : advanceOutcome(certificate);
  outcomes.advance = advance.outcome;
  const { terms } = advance;

  // Une facture est financée si et seulement si un prêt la référence : N ne doit être référencé par aucun prêt,
  // dans aucun des fonds (LoanBroker) de Bari.
  const bariRecords = await listOwnerLoanRecords(ledger, parties.bari);
  const financed = bariRecords.some((record) => !(record.reference instanceof Error) && record.reference.nullifier === reference.nullifier);
  outcomes.unique = financed ? "This invoice is already financed by an Atlas loan" : undefined;

  if (terms === undefined) {
    outcomes.concentration = NEEDS_TIER;
  } else {
    const records = bariRecords.filter((record) => record.loan.LoanBrokerID === fund.brokerId);
    const fundAssets = valueToUnits((await ledger.vault(fund.cohort.vaultId)).AssetsTotal);
    const current = exposuresByPseudonym(records).find((exposure) => exposure.pseudonym === reference.pseudonym);
    const exposureAfter = (current?.outstanding ?? 0n) + terms.principal;
    const share = formatPercent(ratioPercent(exposureAfter, fundAssets));
    log.info(`concentration P=${reference.pseudonym.slice(0, 8)}… : ${formatRlusd(exposureAfter, 2)} / ${formatRlusd(fundAssets, 2)} = ${share}`);
    outcomes.concentration =
      exposureAfter > concentrationLimit(fundAssets)
        ? `Exposure to this debtor would reach ${share} of the fund, above the ${MAX_DEBTOR_CONCENTRATION_PERCENT} % limit`
        : undefined;
  }

  outcomes.maturity =
    certificate === undefined
      ? NEEDS_PROOF
      : maturityProblem({
          now: await ledger.closeTime(),
          invoiceDueDate: unixTimeToRippleTime(certificate.dueDate * MS_PER_SECOND),
          redemptionDate: fund.cohort.redemptionDate,
        });

  const checks = (Object.keys(LOAN_CHECK_LABELS) as LoanCheckId[]).map((id): LoanCheck => {
    const reason = outcomes[id];
    return reason === undefined ? { id, label: LOAN_CHECK_LABELS[id], ok: true } : { id, label: LOAN_CHECK_LABELS[id], ok: false, reason };
  });
  if (certificate === undefined || terms === undefined || checks.some((check) => !check.ok)) return { checks };
  log.info(`contrôles Bari OK pour ${parties.borrower} : palier ${formatUsd(terms.invoice, 2)}, avance ${formatRlusd(terms.principal, 2)}`);
  return { checks, approval: { certificate, terms } };
}
