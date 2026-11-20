// Contrôles de Bari avant de co-signer un prêt (IDEE §5 point 4) : certificat conforme, unicité, concentration.
// Sur devnet, le ledger ne vérifie ni le KYB de l'emprunteur ni le certificat : c'est Bari qui refuse de co-signer.

import type { Actors } from "../accounts/actors.js";
import { ADVANCE_RATE_PERCENT, MAX_DEBTOR_CONCENTRATION_PERCENT } from "../config/finance.js";
import { concentrationLimit, exposuresByPseudonym } from "../fund/concentration.js";
import type { Fund } from "../fund/fund.js";
import { inspectInvoice } from "../fund/invoiceInspection.js";
import type { LoanReference } from "../fund/loanData.js";
import { listOwnerLoanRecords } from "../fund/loanRecords.js";
import { centsToUnits, formatEur, formatPercent, parseUnits, percentOf, ratioPercent } from "../lib/amounts.js";
import { log } from "../lib/logger.js";
import { isSmeKybDone } from "../kyb/smeKyb.js";
import type { Ledger } from "../xrpl/ledger.js";

class LoanRefused extends Error {
  constructor(reason: string) {
    super(`Bari refuse de co-signer : ${reason}`);
  }
}

async function checkSmeKyb(ledger: Ledger, actors: Actors): Promise<void> {
  if (!(await isSmeKybDone(ledger, actors.sme.address, actors.kyb_issuer.address))) {
    throw new LoanRefused("KYB de la PME absent ou non accepté");
  }
}

/** Vérifie le certificat, l'unicité de N parmi les prêts de tous les fonds de Bari et le plafond par pseudonyme P. */
export async function verifyBeforeCosigning(
  ledger: Ledger,
  actors: Actors,
  fund: Fund,
  reference: LoanReference,
  principal: bigint,
): Promise<void> {
  await checkSmeKyb(ledger, actors);

  const inspection = await inspectInvoice(ledger, reference, {
    borrower: actors.sme.address,
    bari: actors.bari.address,
    manifest: fund.manifest,
  });
  if (inspection.problems.length > 0) throw new LoanRefused(inspection.problems.join(" ; "));
  if (!inspection.heldByBari) throw new LoanRefused("Bari ne détient pas le MPT facture");
  if (inspection.certificate === undefined || inspection.proof === undefined) throw new LoanRefused("certificat illisible");

  // Suffisance : la facture prouvée (seuil) doit couvrir le principal au taux d'avance.
  const provenFloor = centsToUnits(inspection.certificate.thresholdCents);
  if (principal > percentOf(provenFloor, ADVANCE_RATE_PERCENT)) {
    throw new LoanRefused(`principal ${formatEur(principal, 2)} > ${formatPercent(ADVANCE_RATE_PERCENT)} du seuil prouvé ${formatEur(provenFloor, 2)}`);
  }

  // Une facture est financée si et seulement si un prêt la référence : N ne doit être référencé par aucun prêt,
  // dans aucun des fonds (LoanBroker) de Bari.
  const bariRecords = await listOwnerLoanRecords(ledger, actors.bari.address);
  if (bariRecords.some((record) => !(record.reference instanceof Error) && record.reference.nullifier === reference.nullifier)) {
    throw new LoanRefused("cette facture est déjà référencée par un prêt d'un fonds Bari");
  }

  const records = bariRecords.filter((record) => record.loan.LoanBrokerID === fund.brokerId);
  const fundAssets = parseUnits((await ledger.vault(fund.cohort.vaultId)).AssetsTotal);
  const current = exposuresByPseudonym(records).find((exposure) => exposure.pseudonym === reference.pseudonym);
  const exposureAfter = (current?.outstanding ?? 0n) + principal;
  const limit = concentrationLimit(fundAssets);
  const share = formatPercent(ratioPercent(exposureAfter, fundAssets));
  if (exposureAfter > limit) {
    throw new LoanRefused(`concentration sur P ${share} > ${formatPercent(MAX_DEBTOR_CONCENTRATION_PERCENT)} du fonds`);
  }
  log.info(
    `contrôles Bari OK : KYB, credential N émis par la PME, MPT facture détenu, entrées publiques cohérentes, seuil ${formatEur(provenFloor, 2)}`,
  );
  log.info(
    `concentration P=${reference.pseudonym.slice(0, 8)}… : ${formatEur(exposureAfter, 2)} / ${formatEur(fundAssets, 2)} = ${share} ≤ ${formatPercent(MAX_DEBTOR_CONCENTRATION_PERCENT)} (marge ${formatEur(limit - exposureAfter, 2)})`,
  );
}
