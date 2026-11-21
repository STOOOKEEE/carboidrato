// Vue publique du fonds courant : état persisté complété par le ledger (phase, actifs, first-loss, encours).
// Montants en unités EURc (6 décimales), sérialisés en chaînes.

import { rippleTimeToISOTime } from "xrpl";
import { parseUnits } from "../../lib/amounts.js";
import { getLoan, getLoanBroker, getVault } from "../../xrpl/ledgerEntries.js";
import { ledgerTime } from "../../xrpl/ledgerTime.js";
import type { ApiContext } from "./context.js";
import type { FundState } from "./stateStore.js";

export type FundPhase = "subscription" | "investment" | "redemption";

export function phaseAt(time: number, state: FundState): FundPhase {
  if (time < state.fund.cohort.subscriptionDate) return "subscription";
  return time < state.fund.cohort.redemptionDate ? "investment" : "redemption";
}

export async function fundView(context: ApiContext, state: FundState) {
  const { client } = context;
  const { fund } = state;
  const [now, vault, broker] = await Promise.all([
    ledgerTime(client),
    getVault(client, fund.cohort.vaultId),
    getLoanBroker(client, fund.brokerId),
  ]);
  const loans = await Promise.all(
    state.loans.map(async (loan) => {
      const entry = await getLoan(client, loan.loanId);
      return {
        ...loan,
        principalOutstanding: parseUnits(entry.PrincipalOutstanding),
        totalValueOutstanding: parseUnits(entry.TotalValueOutstanding),
        // Omis du ledger une fois le prêt soldé.
        nextPaymentDueDate:
          entry.NextPaymentDueDate === undefined ? undefined : rippleTimeToISOTime(entry.NextPaymentDueDate),
      };
    }),
  );
  return {
    ...fund,
    createdAt: state.createdAt,
    deposited: state.deposited,
    redeemed: state.redeemed,
    phase: phaseAt(now, state),
    ledgerTime: rippleTimeToISOTime(now),
    subscriptionEndsAt: rippleTimeToISOTime(fund.cohort.subscriptionDate),
    redemptionStartsAt: rippleTimeToISOTime(fund.cohort.redemptionDate),
    vault: {
      assetsTotal: parseUnits(vault.AssetsTotal),
      assetsAvailable: parseUnits(vault.AssetsAvailable),
      lossUnrealized: parseUnits(vault.LossUnrealized),
    },
    broker: {
      coverAvailable: parseUnits(broker.CoverAvailable),
      debtTotal: parseUnits(broker.DebtTotal),
    },
    invoices: state.invoices.map(({ tokenId, certificate, issuedAt }) => ({
      tokenId,
      issuedAt,
      nullifier: certificate.nullifier,
      pseudonym: certificate.pseudonym,
      commitment: certificate.commitment,
      financed: state.loans.some((loan) => loan.reference.invoiceTokenId === tokenId),
    })),
    loans,
  };
}
