// Carte du fonds : phase, prix de la part, actifs, taux d'utilisation et first-loss de Bari.
import type { FundPhase, LenderPosition } from "../../../../src/api/contract";
import { formatDate, formatPercent } from "../../format";
import { TRANSPARENCY_ROUTE } from "../../routes";
import { Facts, type Fact } from "../../ui/Facts";
import { formatEurUnits, formatSharePrice, utilisationPercent, type LendFund } from "./lend.machine";

function phaseLabel(phase: FundPhase, fund: LendFund | undefined): string {
  switch (phase) {
    case "subscription":
      return fund === undefined ? "Subscription open" : `Subscription open until ${formatDate(fund.subscriptionEndsAt)}`;
    case "investment":
      return fund === undefined ? "Lending" : `Lending until ${formatDate(fund.redemptionStartsAt)}`;
    case "redemption":
      return "Repaying lenders: exit for free";
  }
}

export function FundCard({ position, fund }: { position: LenderPosition; fund: LendFund | undefined }) {
  const facts: Fact[] = [
    { label: "Phase", value: phaseLabel(position.phase, fund) },
    { label: "Share price", value: formatSharePrice(position.sharePrice) },
  ];
  if (fund !== undefined) {
    facts.push(
      { label: "In the fund", value: formatEurUnits(BigInt(fund.vault.assetsTotal)) },
      { label: "Lent to businesses", value: formatPercent(utilisationPercent(fund.vault)) },
      { label: "First-loss cover from Bari", value: formatEurUnits(BigInt(fund.broker.coverAvailable)) },
      { label: "Invoices financed", value: String(fund.loans.length) },
    );
  }
  return (
    <section className="step" data-testid="lend-fund">
      <h2>The fund</h2>
      <Facts facts={facts} />
      {fund === undefined && (
        <p className="muted small">The fund's other figures are unavailable right now: reload the page to try again.</p>
      )}
      <p className="muted small">
        Bari's first-loss cover absorbs the first defaults before lenders do.{" "}
        <a className="link" href={TRANSPARENCY_ROUTE}>
          Check every loan and its proof
        </a>
      </p>
    </section>
  );
}
