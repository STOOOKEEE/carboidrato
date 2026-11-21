// Vue publique du fonds courant : état persisté complété par le ledger (phase, actifs, first-loss, encours).
// Montants en unités RLUSD (6 décimales), sérialisés en chaînes ; l'actif est nommé en clair (« RLUSD ») avec son émetteur.

import { rippleTimeToISOTime } from "xrpl";
import { currencyLabel, valueToUnits } from "../../xrpl/stablecoin.js";
import type { ApiContext } from "./context.js";
import type { FundState } from "./stateStore.js";

export type FundPhase = "subscription" | "investment" | "redemption";

export function phaseAt(time: number, state: FundState): FundPhase {
  if (time < state.fund.cohort.subscriptionDate) return "subscription";
  return time < state.fund.cohort.redemptionDate ? "investment" : "redemption";
}

export async function fundView(context: ApiContext, state: FundState) {
  const { ledger } = context;
  const { fund } = state;
  const [now, vault, broker] = await Promise.all([
    ledger.closeTime(),
    ledger.vault(fund.cohort.vaultId),
    ledger.loanBroker(fund.brokerId),
  ]);
  const loans = await Promise.all(
    state.loans.map(async (loan) => {
      const entry = await ledger.loan(loan.loanId);
      return {
        ...loan,
        principalOutstanding: valueToUnits(entry.PrincipalOutstanding),
        totalValueOutstanding: valueToUnits(entry.TotalValueOutstanding),
        // Omis du ledger une fois le prêt soldé.
        nextPaymentDueDate:
          entry.NextPaymentDueDate === undefined ? undefined : rippleTimeToISOTime(entry.NextPaymentDueDate),
      };
    }),
  );
  return {
    ...fund,
    asset: { currency: currencyLabel(fund.stablecoin.currency), issuer: fund.stablecoin.issuer },
    createdAt: state.createdAt,
    deposited: state.deposited,
    redeemed: state.redeemed,
    phase: phaseAt(now, state),
    ledgerTime: rippleTimeToISOTime(now),
    subscriptionEndsAt: rippleTimeToISOTime(fund.cohort.subscriptionDate),
    redemptionStartsAt: rippleTimeToISOTime(fund.cohort.redemptionDate),
    vault: {
      assetsTotal: valueToUnits(vault.AssetsTotal),
      assetsAvailable: valueToUnits(vault.AssetsAvailable),
      lossUnrealized: valueToUnits(vault.LossUnrealized),
    },
    broker: {
      coverAvailable: valueToUnits(broker.CoverAvailable),
      debtTotal: valueToUnits(broker.DebtTotal),
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
