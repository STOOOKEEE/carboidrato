// Audit public du fonds (IDEE §5 point 5) à partir du ledger seul : n'importe qui, avec l'ID du Vault ou du broker,
// relit chaque prêt, son certificat et sa preuve, l'unicité des empreintes N et la concentration par pseudonyme P.

import { LedgerEntry, type Client } from "xrpl";
import { MAX_DEBTOR_CONCENTRATION_PERCENT } from "../config/finance.js";
import { concentrationLimit, exposuresByPseudonym, type PseudonymExposure } from "../fund/concentration.js";
import { decodeFundManifest, type FundManifest } from "../fund/fundManifest.js";
import { inspectInvoice } from "../fund/invoiceInspection.js";
import { listLoanRecords, type LoanRecord } from "../fund/loanRecords.js";
import { describeVerdict, type ProofVerdict } from "../invoice/proofVerification.js";
import type { LoanReference } from "../lending/loanData.js";
import { formatEur, formatPercent, parseUnits, ratioPercent } from "../lib/amounts.js";
import { log } from "../lib/logger.js";
import { findEntry, getLoanBroker, getVault, listAccountObjects } from "../xrpl/ledgerEntries.js";

const CUSTODY_PROBLEM = "prêt en cours sans MPT facture chez Bari";

export type LoanStatus = "en défaut" | "déprécié" | "en cours" | "remboursé";

/** Résultat de l'audit d'un prêt. Montants en unités EURc. */
export interface LoanAudit {
  loanId: string;
  loanSequence: number;
  loanSetHash: string;
  principal: bigint;
  outstanding: bigint;
  status: LoanStatus;
  /** Référence au certificat (absente si le Data du LoanSet est illisible). */
  reference: LoanReference | undefined;
  problems: string[];
  proof: ProofVerdict | undefined;
  heldByBari: boolean;
  anomalies: number;
}

export interface UniquenessAudit {
  distinctNullifiers: number;
  referencedNullifiers: number;
  duplicates: number;
}

export interface ConcentrationAudit {
  /** Plafond par débiteur (absent si l'actif du fonds est nul). */
  limit: bigint | undefined;
  exposures: Array<PseudonymExposure & { breach: boolean }>;
  anomalies: number;
}

export interface AuditResult {
  loans: number;
  anomalies: number;
  verifiedProofs: number;
  vaultId: string;
  brokerId: string;
  owner: string;
  manifest: FundManifest;
  fundAssets: bigint;
  coverAvailable: bigint;
  debtTotal: bigint;
  loanAudits: LoanAudit[];
  uniqueness: UniquenessAudit;
  concentration: ConcentrationAudit;
}

interface AuditedFund {
  vaultId: string;
  vault: LedgerEntry.Vault;
  brokerId: string;
  broker: LedgerEntry.LoanBroker;
}

/** Accepte l'ID du Vault (broker retrouvé chez son propriétaire) ou celui du LoanBroker. */
async function resolveFund(client: Client, id: string): Promise<AuditedFund> {
  const entry = await findEntry(client, id);
  if (entry?.LedgerEntryType === "LoanBroker") {
    return { vaultId: entry.VaultID, vault: await getVault(client, entry.VaultID), brokerId: id, broker: entry };
  }
  if (entry?.LedgerEntryType !== "Vault") throw new Error(`${id} n'est ni un Vault ni un LoanBroker validé`);
  const brokers = (await listAccountObjects(client, entry.Owner, "loan_broker")).filter(
    (object): object is LedgerEntry.LoanBroker => object.LedgerEntryType === "LoanBroker" && object.VaultID === id,
  );
  if (brokers.length !== 1) throw new Error(`Vault ${id} : ${brokers.length} LoanBroker trouvés (1 attendu)`);
  const broker = brokers[0];
  return { vaultId: id, vault: entry, brokerId: broker.index, broker: await getLoanBroker(client, broker.index) };
}

function loanStatus(record: LoanRecord): LoanStatus {
  if ((record.loan.Flags & LedgerEntry.LoanFlags.lsfLoanDefault) !== 0) return "en défaut";
  if ((record.loan.Flags & LedgerEntry.LoanFlags.lsfLoanImpaired) !== 0) return "déprécié";
  return record.outstanding > 0n ? "en cours" : "remboursé";
}

async function auditLoan(
  client: Client,
  record: LoanRecord,
  fund: AuditedFund,
  manifest: FundManifest,
): Promise<LoanAudit> {
  const status = loanStatus(record);
  const base = {
    loanId: record.loanId,
    loanSequence: record.loan.LoanSequence,
    loanSetHash: record.loanSetHash,
    principal: record.principal,
    outstanding: record.outstanding,
    status,
  };
  log.info(
    `prêt #${record.loan.LoanSequence} ${record.loanId} · LoanSet ${record.loanSetHash} · principal ${formatEur(record.principal, 2)} · restant dû ${formatEur(record.outstanding, 2)} · ${status}`,
  );
  if (record.reference instanceof Error) {
    const problem = `Data illisible : ${record.reference.message}`;
    log.warn(`  ✗ ${problem}`);
    return { ...base, reference: undefined, problems: [problem], proof: undefined, heldByBari: false, anomalies: 1 };
  }
  const { nullifier, pseudonym, invoiceTokenId } = record.reference;
  log.info(`  N=${nullifier} · P=${pseudonym} · MPT facture ${invoiceTokenId}`);
  const inspection = await inspectInvoice(client, record.reference, {
    borrower: record.loan.Borrower,
    bari: fund.broker.Owner,
    manifest,
    networkId: client.networkID,
  });
  for (const problem of inspection.problems) log.warn(`  ✗ ${problem}`);
  if (inspection.problems.length === 0) {
    log.info("  ✓ credential N émis par l'emprunteur · ✓ MPT facture émis par l'emprunteur · ✓ métadonnées avec preuve, entrées publiques cohérentes");
  }
  if (inspection.proof !== undefined) log.info(`  ${describeVerdict(inspection.proof)}`);
  const active = record.outstanding > 0n;
  log.info(`  MPT facture détenu par Bari : ${inspection.heldByBari ? "oui" : active ? "NON" : "non (rendu à la PME)"}`);
  const custodyAnomaly = active && !inspection.heldByBari ? 1 : 0;
  if (custodyAnomaly > 0) log.warn(`  ✗ ${CUSTODY_PROBLEM}`);
  return {
    ...base,
    reference: record.reference,
    problems: custodyAnomaly > 0 ? [...inspection.problems, CUSTODY_PROBLEM] : inspection.problems,
    proof: inspection.proof,
    heldByBari: inspection.heldByBari,
    anomalies: inspection.problems.length + custodyAnomaly,
  };
}

function auditUniqueness(records: readonly LoanRecord[]): UniquenessAudit {
  const nullifiers = records.flatMap((record) => (record.reference instanceof Error ? [] : [record.reference.nullifier]));
  const distinctNullifiers = new Set(nullifiers).size;
  const duplicates = nullifiers.length - distinctNullifiers;
  log.info(`unicité : ${distinctNullifiers} empreinte(s) N distincte(s) pour ${nullifiers.length} prêt(s) ${duplicates === 0 ? "✓" : "✗"}`);
  return { distinctNullifiers, referencedNullifiers: nullifiers.length, duplicates };
}

function auditConcentration(records: readonly LoanRecord[], fundAssets: bigint): ConcentrationAudit {
  const limit = fundAssets > 0n ? concentrationLimit(fundAssets) : undefined;
  log.info(
    limit === undefined
      ? "concentration : fonds clos (actif nul), plafond sur l'encours sans objet"
      : `concentration : plafond ${formatPercent(MAX_DEBTOR_CONCENTRATION_PERCENT)} de l'actif (${formatEur(fundAssets, 2)}) = ${formatEur(limit, 2)} par débiteur`,
  );
  let anomalies = 0;
  const exposures: ConcentrationAudit["exposures"] = [];
  for (const exposure of exposuresByPseudonym(records)) {
    const share = limit === undefined ? "" : ` = ${formatPercent(ratioPercent(exposure.outstanding, fundAssets))} de l'actif`;
    const breach = limit !== undefined && exposure.outstanding > limit;
    if (breach) anomalies += 1;
    exposures.push({ ...exposure, breach });
    log.info(
      `  P=${exposure.pseudonym.slice(0, 16)}… : ${exposure.loans} prêt(s), prêté ${formatEur(exposure.financed, 2)}, encours ${formatEur(exposure.outstanding, 2)}${share} ${breach ? "✗" : "✓"}`,
    );
  }
  return { limit, exposures, anomalies };
}

export async function auditFund(client: Client, id: string): Promise<AuditResult> {
  const fund = await resolveFund(client, id);
  const manifest = decodeFundManifest(fund.vault.Data);
  const fundAssets = parseUnits(fund.vault.AssetsTotal);
  log.info(`Vault ${fund.vaultId} · LoanBroker ${fund.brokerId} · propriétaire ${fund.broker.Owner}`);
  log.info(`fiche du fonds (Data du Vault) : racine ${manifest.debtorsRoot}, millésime ${manifest.vintage}, registre ${manifest.registry}`);
  log.info(`actif du fonds ${formatEur(fundAssets)} · first-loss ${formatEur(parseUnits(fund.broker.CoverAvailable))} · dette ${formatEur(parseUnits(fund.broker.DebtTotal))}`);

  const records = await listLoanRecords(client, fund.brokerId);
  const loanAudits: LoanAudit[] = [];
  for (const record of records) loanAudits.push(await auditLoan(client, record, fund, manifest));
  const verifiedProofs = loanAudits.filter((audit) => audit.proof?.status === "valid").length;
  const uniqueness = auditUniqueness(records);
  const concentration = auditConcentration(records, fundAssets);
  const anomalies =
    loanAudits.reduce((total, audit) => total + audit.anomalies, 0) + uniqueness.duplicates + concentration.anomalies;
  log.info(
    `bilan : ${records.length} prêt(s), ${anomalies} anomalie(s), preuves vérifiées cryptographiquement ${verifiedProofs}/${records.length}`,
  );
  return {
    loans: records.length,
    anomalies,
    verifiedProofs,
    vaultId: fund.vaultId,
    brokerId: fund.brokerId,
    owner: fund.broker.Owner,
    manifest,
    fundAssets,
    coverAvailable: parseUnits(fund.broker.CoverAvailable),
    debtTotal: parseUnits(fund.broker.DebtTotal),
    loanAudits,
    uniqueness,
    concentration,
  };
}
