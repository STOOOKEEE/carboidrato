// Audit public du fonds courant depuis le ledger seul : prêts avec la preuve brute de leur facture (re-vérifiée dans
// le navigateur de la page Transparency), unicité, concentration et prix de la part.

import type { FastifyInstance } from "fastify";
import { rippleTimeToISOTime } from "xrpl";
import { auditKnownFund, type AuditResult, type LoanAudit, type LoanStatus } from "../../../audit/auditFund.js";
import { MAX_DEBTOR_CONCENTRATION_PERCENT } from "../../../config/finance.js";
import { perDisplayShare, sharePrice } from "../../../fund/sharePrice.js";
import { parseUnits } from "../../../lib/amounts.js";
import type { AuditLoan, AuditLoanStatus, FundAudit } from "../../contract.js";
import { requireFund, type ApiContext } from "../context.js";

const STATUSES: Record<LoanStatus, AuditLoanStatus> = {
  "en cours": "active",
  remboursé: "repaid",
  déprécié: "impaired",
  "en défaut": "defaulted",
};

function loanView(audit: LoanAudit): AuditLoan {
  const certificate = audit.certificate?.proof;
  return {
    loanId: audit.loanId,
    loanSequence: audit.loanSequence,
    loanSetHash: audit.loanSetHash,
    borrower: audit.borrower,
    principal: audit.principal.toString(),
    outstanding: audit.outstanding.toString(),
    status: STATUSES[audit.status],
    ...(audit.nextPaymentDueDate === undefined ? {} : { dueDate: rippleTimeToISOTime(audit.nextPaymentDueDate) }),
    ...(audit.reference === undefined ? {} : { reference: audit.reference }),
    ...(certificate === undefined
      ? {}
      : {
          certificate: {
            proof: {
              pi_a: certificate.proof.pi_a,
              pi_b: certificate.proof.pi_b,
              pi_c: certificate.proof.pi_c,
              protocol: certificate.proof.protocol,
              curve: certificate.proof.curve,
            },
            publicSignals: certificate.publicSignals,
          },
        }),
    anomalies: audit.anomalies,
  };
}

function auditView(result: AuditResult, price: bigint): FundAudit {
  return {
    vaultId: result.vaultId,
    brokerId: result.brokerId,
    owner: result.owner,
    manifest: result.manifest,
    loans: result.loans,
    verifiedProofs: result.verifiedProofs,
    anomalies: result.anomalies,
    fundAssets: result.fundAssets.toString(),
    sharePrice: price.toString(),
    concentrationLimitPercent: MAX_DEBTOR_CONCENTRATION_PERCENT,
    loanAudits: result.loanAudits.map(loanView),
  };
}

export function registerAuditRoutes(app: FastifyInstance, context: ApiContext): void {
  // Lecture seule : hors de la file des opérations, l'audit ne signe rien.
  app.get("/api/audit", async (): Promise<FundAudit> => {
    const { fund } = requireFund(context);
    const [result, vault, shares] = await Promise.all([
      auditKnownFund(context.ledger, fund.cohort.vaultId, fund.brokerId),
      context.ledger.vault(fund.cohort.vaultId),
      context.ledger.mptIssuance(fund.cohort.shareMptId),
    ]);
    if (shares === undefined) throw new Error(`Émission des parts introuvable : ${fund.cohort.shareMptId}`);
    const price = sharePrice({
      assetsTotal: parseUnits(vault.AssetsTotal),
      lossUnrealized: parseUnits(vault.LossUnrealized),
      sharesOutstanding: parseUnits(shares.OutstandingAmount),
    });
    return auditView(result, perDisplayShare(price.assets, price.shares));
  });
}
