// Contrôles de Bari avant de co-signer un prêt (IDEE §5 point 4) : certificat conforme, unicité, concentration.
// Sur devnet, le ledger ne vérifie ni le KYB de l'emprunteur ni le certificat : c'est Bari qui refuse de co-signer.

import type { Client } from "xrpl";
import type { Actors } from "../accounts/actors.js";
import { ADVANCE_RATE_PERCENT, MAX_DEBTOR_CONCENTRATION_PERCENT } from "../config/finance.js";
import { concentrationLimit, exposuresByPseudonym } from "../fund/concentration.js";
import type { Fund } from "../fund/fund.js";
import { inspectInvoice } from "../fund/invoiceInspection.js";
import type { LoanReference } from "../fund/loanData.js";
import { listLoanRecords } from "../fund/loanRecords.js";
import { centsToUnits, formatEur, formatPercent, parseUnits, percentOf, ratioPercent } from "../lib/amounts.js";
import { log } from "../lib/logger.js";
import { isSmeKybDone } from "../kyb/smeKyb.js";
import { getVault } from "../xrpl/ledgerEntries.js";

class LoanRefused extends Error {
  constructor(reason: string) {
    super(`Bari refuse de co-signer : ${reason}`);
  }
}

async function checkSmeKyb(client: Client, actors: Actors): Promise<void> {
  if (!(await isSmeKybDone(client, actors.sme.address, actors.kyb_issuer.address))) {
    throw new LoanRefused("KYB de la PME absent ou non accepté");
  }
}

/** Vérifie le certificat, l'unicité de N parmi les prêts du fonds et le plafond par pseudonyme P. */
export async function verifyBeforeCosigning(
  client: Client,
  actors: Actors,
  fund: Fund,
  reference: LoanReference,
  principal: bigint,
): Promise<void> {
  await checkSmeKyb(client, actors);

  const inspection = await inspectInvoice(client, reference, {
    borrower: actors.sme.address,
    bari: actors.bari.address,
    manifest: fund.manifest,
    networkId: client.networkID,
  });
  if (inspection.problems.length > 0) throw new LoanRefused(inspection.problems.join(" ; "));
  if (!inspection.heldByBari) throw new LoanRefused("Bari ne détient pas le MPT facture");
  if (inspection.certificate === undefined || inspection.proof === undefined) throw new LoanRefused("certificat illisible");

  // Suffisance : la facture prouvée (seuil) doit couvrir le principal au taux d'avance.
  const provenFloor = centsToUnits(inspection.certificate.thresholdCents);
  if (principal > percentOf(provenFloor, ADVANCE_RATE_PERCENT)) {
    throw new LoanRefused(`principal ${formatEur(principal, 2)} > ${formatPercent(ADVANCE_RATE_PERCENT)} du seuil prouvé ${formatEur(provenFloor, 2)}`);
  }

  // Une facture est financée si et seulement si un prêt la référence : N ne doit être référencé par aucun prêt.
  const records = await listLoanRecords(client, fund.brokerId);
  if (records.some((record) => !(record.reference instanceof Error) && record.reference.nullifier === reference.nullifier)) {
    throw new LoanRefused("cette facture est déjà référencée par un prêt du fonds");
  }

  const fundAssets = parseUnits((await getVault(client, fund.cohort.vaultId)).AssetsTotal);
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
