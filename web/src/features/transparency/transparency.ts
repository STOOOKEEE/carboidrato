// Page Transparency, pure : liaison de chaque preuve à son prêt, vérification par un vérificateur injecté (snarkjs dans
// la page), relances, empreintes uniques, exposition par pseudonyme de débiteur, chiffres clés et lignes du tableau.

import {
  PROOF_PUBLIC_SIGNALS,
  type AuditLoan,
  type AuditLoanStatus,
  type CertificateRequest,
  type FundAudit,
} from "../../../../src/api/contract";
import { formatDate, formatPercent, shortHash } from "../../format";
import { formatEurUnits, formatSharePrice, utilisationPercent, type LendFund } from "../lend/lend.machine";

/** `mismatch` : la preuve tient, mais pour un autre prêt ou un autre fonds ; `missing` : aucune preuve lisible. */
export type LoanVerdict = "verified" | "invalid" | "mismatch" | "missing";

export type ProofVerifier = (certificate: CertificateRequest) => Promise<boolean>;

export type Verification =
  | { status: "idle"; round: number }
  | { status: "verifying"; round: number }
  | { status: "done"; round: number; verdicts: LoanVerdict[]; durationMs: number }
  | { status: "failed"; round: number; message: string };

export type VerificationEvent =
  | { type: "START" }
  | { type: "DONE"; verdicts: LoanVerdict[]; durationMs: number }
  | { type: "FAILED"; message: string };

export const initialVerification: Verification = { status: "idle", round: 0 };

const HEX_32_LENGTH = 64;
const MS_PER_SECOND = 1_000;
/** Pourcentages en centièmes, tronqués, sans flottant sur les montants. */
const HUNDREDTHS = 100;
const BASIS_POINTS_PER_WHOLE = 10_000n;

const STATUS_LABELS: Record<AuditLoanStatus, string> = {
  active: "Active",
  repaid: "Repaid",
  impaired: "Impaired",
  defaulted: "Defaulted",
};

const VERDICT_LABELS: Record<LoanVerdict, string> = {
  verified: "Verified",
  invalid: "Invalid proof",
  mismatch: "Does not match this loan",
  missing: "No proof found",
};

/** Signal public décimal → hex 32 octets majuscule, comme N et P dans le Data du `LoanSet`. */
function signalHex(certificate: CertificateRequest, name: (typeof PROOF_PUBLIC_SIGNALS)[number]): string {
  return BigInt(certificate.publicSignals[PROOF_PUBLIC_SIGNALS.indexOf(name)]).toString(16).toUpperCase().padStart(HEX_32_LENGTH, "0");
}

/** La preuve parle bien de ce prêt (N, P du `LoanSet`) et de ce fonds (racine des débiteurs, millésime). */
function bindsLoan(certificate: CertificateRequest, reference: NonNullable<AuditLoan["reference"]>, manifest: FundAudit["manifest"]): boolean {
  if (certificate.publicSignals.length !== PROOF_PUBLIC_SIGNALS.length) return false;
  try {
    return (
      signalHex(certificate, "nullifier") === reference.nullifier.toUpperCase() &&
      signalHex(certificate, "pseudonym") === reference.pseudonym.toUpperCase() &&
      signalHex(certificate, "debtorsRoot") === manifest.debtorsRoot.toUpperCase() &&
      certificate.publicSignals[PROOF_PUBLIC_SIGNALS.indexOf("vintage")] === String(manifest.vintage)
    );
  } catch {
    return false;
  }
}

async function verifyLoan(loan: AuditLoan, manifest: FundAudit["manifest"], verify: ProofVerifier): Promise<LoanVerdict> {
  if (loan.certificate === undefined || loan.reference === undefined) return "missing";
  if (!bindsLoan(loan.certificate, loan.reference, manifest)) return "mismatch";
  try {
    return (await verify(loan.certificate)) ? "verified" : "invalid";
  } catch {
    return "invalid";
  }
}

/** Une preuve après l'autre : le vérificateur prépare sa courbe une seule fois. */
export async function verifyLoans(audit: FundAudit, verify: ProofVerifier): Promise<LoanVerdict[]> {
  const verdicts: LoanVerdict[] = [];
  for (const loan of audit.loanAudits) verdicts.push(await verifyLoan(loan, audit.manifest, verify));
  return verdicts;
}

export function verificationTransition(run: Verification, event: VerificationEvent): Verification {
  if (event.type === "START") return run.status === "verifying" ? run : { status: "verifying", round: run.round + 1 };
  if (run.status !== "verifying") return run;
  return event.type === "DONE"
    ? { status: "done", round: run.round, verdicts: event.verdicts, durationMs: event.durationMs }
    : { status: "failed", round: run.round, message: event.message };
}

export function proofTally(verdicts: readonly LoanVerdict[]): { verified: number; total: number } {
  return { verified: verdicts.filter((verdict) => verdict === "verified").length, total: verdicts.length };
}

export function runSummary(run: Verification): string {
  switch (run.status) {
    case "idle":
    case "verifying":
      return "Verifying every proof in your browser…";
    case "failed":
      return run.message;
    case "done": {
      const { verified, total } = proofTally(run.verdicts);
      return `${verified}/${total} proofs verified in your browser, in ${(run.durationMs / MS_PER_SECOND).toFixed(1)} s.`;
    }
  }
}

export interface FingerprintTally {
  distinct: number;
  /** Prêts dont le `LoanSet` porte une empreinte lisible. */
  total: number;
  /** Empreintes portées par plusieurs prêts. */
  duplicates: string[];
}

export function fingerprintTally(loans: readonly AuditLoan[]): FingerprintTally {
  const counts = new Map<string, number>();
  for (const { reference } of loans) {
    if (reference !== undefined) counts.set(reference.nullifier, (counts.get(reference.nullifier) ?? 0) + 1);
  }
  return {
    distinct: counts.size,
    total: [...counts.values()].reduce((sum, count) => sum + count, 0),
    duplicates: [...counts].filter(([, count]) => count > 1).map(([nullifier]) => nullifier),
  };
}

export interface Exposure {
  pseudonym: string;
  /** Alias court du pseudonyme P, affiché en mono. */
  alias: string;
  loans: number;
  /** Principal restant dû sur ce débiteur, en unités EURc : c'est lui qui est plafonné. */
  outstanding: bigint;
  /** Part de l'actif du fonds, en %. */
  fundPercent: number;
  /** Remplissage de la barre, dont la pleine longueur est le plafond par débiteur (100 au-delà). */
  barPercent: number;
  breach: boolean;
}

/** `numerator / denominator` en % au centième, tronqué ; 0 si le dénominateur est nul. */
function percent(numerator: bigint, denominator: bigint): number {
  if (denominator === 0n) return 0;
  return Number((numerator * BASIS_POINTS_PER_WHOLE) / denominator) / HUNDREDTHS;
}

export function exposures(audit: FundAudit): Exposure[] {
  const byPseudonym = new Map<string, { loans: number; outstanding: bigint }>();
  for (const { reference, outstanding } of audit.loanAudits) {
    if (reference === undefined) continue;
    const exposure = byPseudonym.get(reference.pseudonym) ?? { loans: 0, outstanding: 0n };
    byPseudonym.set(reference.pseudonym, { loans: exposure.loans + 1, outstanding: exposure.outstanding + BigInt(outstanding) });
  }
  const assets = BigInt(audit.fundAssets);
  const limitBasisPoints = BigInt(Math.round(audit.concentrationLimitPercent * HUNDREDTHS));
  const limit = (assets * limitBasisPoints) / BASIS_POINTS_PER_WHOLE;
  return [...byPseudonym]
    .map(([pseudonym, { loans, outstanding }]) => ({
      pseudonym,
      alias: shortHash(pseudonym, 4),
      loans,
      outstanding,
      fundPercent: percent(outstanding, assets),
      barPercent: Math.min(percent(outstanding * BASIS_POINTS_PER_WHOLE, assets * limitBasisPoints), HUNDREDTHS),
      breach: assets > 0n && outstanding > limit,
    }))
    .sort((a, b) => (a.outstanding === b.outstanding ? a.alias.localeCompare(b.alias) : a.outstanding > b.outstanding ? -1 : 1));
}

export const maxExposurePercent = (rows: readonly Exposure[]) => Math.max(0, ...rows.map((row) => row.fundPercent));

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export interface FundCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

export function fundChecks(audit: FundAudit): FundCheck[] {
  const fingerprints = fingerprintTally(audit.loanAudits);
  const rows = exposures(audit);
  const breaches = rows.filter((row) => row.breach).length;
  const largest = `${formatPercent(maxExposurePercent(rows))} of the fund`;
  return [
    {
      id: "unique",
      label: "Each invoice financed once",
      ok: fingerprints.duplicates.length === 0,
      detail:
        fingerprints.duplicates.length === 0
          ? `${plural(fingerprints.distinct, "unique fingerprint")} for ${plural(fingerprints.total, "loan")}`
          : `${plural(fingerprints.duplicates.length, "fingerprint")} used by more than one loan`,
    },
    {
      id: "concentration",
      label: `No debtor above ${formatPercent(audit.concentrationLimitPercent)} of the fund`,
      ok: breaches === 0,
      detail: breaches === 0 ? `Largest exposure: ${largest}` : `${plural(breaches, "debtor")} above the limit (largest: ${largest})`,
    },
  ];
}

export interface KeyFigure {
  id: "proofs" | "debtors" | "exposure" | "price" | "lent";
  label: string;
  value: string;
}

/** `fund` : `GET /api/fund`, absent s'il n'a pas pu être lu (le taux d'utilisation s'affiche alors « — »). */
export function keyFigures(audit: FundAudit, fund: Pick<LendFund, "vault"> | undefined, run: Verification): KeyFigure[] {
  const rows = exposures(audit);
  const proofs =
    run.status === "done"
      ? `${proofTally(run.verdicts).verified}/${run.verdicts.length}`
      : run.status === "failed"
        ? "—"
        : "…";
  return [
    { id: "proofs", label: "Proofs verified in your browser", value: proofs },
    { id: "debtors", label: "Distinct debtors", value: String(rows.length) },
    { id: "exposure", label: "Largest exposure to one debtor", value: formatPercent(maxExposurePercent(rows)) },
    { id: "price", label: "Share price", value: formatSharePrice(audit.sharePrice) },
    { id: "lent", label: "Lent to businesses", value: fund === undefined ? "—" : formatPercent(utilisationPercent(fund.vault)) },
  ];
}

export interface LoanRow {
  id: string;
  sequence: number;
  status: string;
  principal: string;
  due: string;
  /** Alias court du pseudonyme P, « — » sans référence lisible. */
  debtor: string;
  fingerprint: string;
  /** Valeurs complètes de P et N, en infobulle. */
  pseudonym?: string;
  nullifier?: string;
  proof: string;
  /** `pending` tant que la vérification tourne, `bad` pour un échec ou une preuve non vérifiée. */
  proofState: "ok" | "pending" | "bad";
  /** Hash du `LoanSet`. */
  hash: string;
}

function proofOf(run: Verification, index: number): Pick<LoanRow, "proof" | "proofState"> {
  if (run.status === "failed") return { proof: "Not checked", proofState: "bad" };
  if (run.status !== "done") return { proof: "Checking…", proofState: "pending" };
  const verdict = run.verdicts[index] ?? "missing";
  return { proof: VERDICT_LABELS[verdict], proofState: verdict === "verified" ? "ok" : "bad" };
}

export function loanRows(audit: FundAudit, run: Verification): LoanRow[] {
  return audit.loanAudits.map((loan, index) => ({
    id: loan.loanId,
    sequence: loan.loanSequence,
    status: STATUS_LABELS[loan.status],
    principal: formatEurUnits(BigInt(loan.principal)),
    due: loan.dueDate === undefined ? "—" : formatDate(loan.dueDate),
    debtor: loan.reference === undefined ? "—" : shortHash(loan.reference.pseudonym, 4),
    fingerprint: loan.reference === undefined ? "—" : shortHash(loan.reference.nullifier, 4),
    pseudonym: loan.reference?.pseudonym,
    nullifier: loan.reference?.nullifier,
    ...proofOf(run, index),
    hash: loan.loanSetHash,
  }));
}
