// Offre de la facture contrôlée et « Get paid now » ; « Already financed » si le registre détient déjà son empreinte.
import type { PrecheckResponse } from "../../../../src/api/contract";
import { formatDate, formatUsd, formatPercent, formatRlusd } from "../../format";
import { Button } from "../../ui/Button";
import { Facts } from "../../ui/Facts";
import { Notice } from "../../ui/Notice";
import { StepCard } from "../../ui/StepCard";
import { TxLink } from "../../ui/TxLink";
import type { FundingState } from "../funding/funding.machine";
import { fundingSteps, getPaidBlocker } from "./business.machine";
import { FundingSteps } from "./FundingSteps";

interface OfferCardProps {
  precheck: PrecheckResponse;
  funding: FundingState;
  onGetPaid: () => void;
  onRetry: () => void;
}

function Outcome({ funding, onGetPaid, onRetry }: Omit<OfferCardProps, "precheck">) {
  switch (funding.status) {
    case "invoiceReady":
      return (
        <Button primary onClick={onGetPaid}>
          Get paid now
        </Button>
      );
    case "error":
      return (
        <>
          <Notice kind="error">{funding.message}</Notice>
          <Button primary onClick={onRetry}>
            Try again
          </Button>
        </>
      );
    case "refused":
      return <Notice kind="error">Bari did not lend: {funding.reason}</Notice>;
    case "funded":
      return (
        <div className="funded" data-testid="business-funded">
          <p className="amount">{formatRlusd(funding.loan.netAdvanceRlusd)}</p>
          <p className="muted">
            received on your account. The loan is due on {formatDate(funding.loan.dueDate)}: repay it once your client has paid
            you.
          </p>
        </div>
      );
    default:
      return null;
  }
}

export function OfferCard({ precheck, funding, onGetPaid, onRetry }: OfferCardProps) {
  if (funding.status === "duplicate") {
    return (
      <section className="step duplicate" data-testid="business-duplicate">
        <header className="step-head">
          <span className="step-index">✗</span>
          <h2>Already financed</h2>
        </header>
        <p className="muted">
          The ledger already holds this invoice's fingerprint: Bari never finances the same invoice twice.
        </p>
        <Facts facts={[{ label: "Registered on the ledger", value: <TxLink hash={funding.txHash} /> }]} />
      </section>
    );
  }
  const blocker = getPaidBlocker(precheck);
  const { offer } = precheck;
  if (blocker !== undefined || offer === undefined) {
    return (
      <StepCard index={2} title="No offer for this invoice" done={false}>
        <Notice kind="error">{blocker}</Notice>
      </StepCard>
    );
  }
  const steps = fundingSteps(funding);
  return (
    <StepCard index={2} title="Your offer" done={funding.status === "funded"}>
      <Facts
        facts={[
          { label: `Advance (${formatPercent(offer.advanceRatePercent)} of the proven tier)`, value: formatUsd(offer.principalUsd) },
          { label: "Fee", value: formatUsd(offer.feeUsd) },
          { label: "You receive now", value: formatUsd(offer.netAdvanceUsd) },
          { label: "Due date", value: `${formatDate(precheck.invoice.dueDate)} (${offer.termDays} days)` },
          { label: "Proven tier", value: `at least ${formatUsd(offer.provenThresholdUsd)}` },
          { label: "You repay at the due date", value: formatUsd(offer.repaymentUsd) },
        ]}
      />
      <p className="muted">
        Bari only learns that your invoice covers at least {formatUsd(offer.provenThresholdUsd)}. The exact amount stays private.
      </p>
      {steps.length > 0 && <FundingSteps steps={steps} />}
      <Outcome funding={funding} onGetPaid={onGetPaid} onRetry={onRetry} />
    </StepCard>
  );
}
