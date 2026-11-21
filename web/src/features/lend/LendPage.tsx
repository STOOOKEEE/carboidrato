// Espace prêteur `#/lend` : position et fonds lus sur le ledger, RLUSD de test, dépôt et retrait natifs ou immédiats,
// signés dans Otsu pour un wallet.
import { useCallback, useEffect, useReducer, useState } from "react";
import type { AccountView, LenderOrderResponse, LenderPosition } from "../../../../src/api/contract";
import { formatDate } from "../../format";
import { Button } from "../../ui/Button";
import { Notice } from "../../ui/Notice";
import { otsuProvider } from "../../wallet/otsu";
import { signWithOtsu } from "../../wallet/sign";
import { AccountCard } from "../account/AccountCard";
import { addTestRlusd, deposit, fetchLendFund, fetchPosition, submitOrder, withdraw } from "./api";
import { FundCard } from "./FundCard";
import {
  checkDeposit,
  checkWithdraw,
  faucetMovement,
  formatRlusdUnits,
  formatSharePrice,
  formatShares,
  initialLendState,
  isBusy,
  lendTransition,
  orderFailure,
  placeOrder,
  ROUTE_LABELS,
  sharesInput,
  tradeMovement,
  type LendAction,
  type LendFund,
  type Movement,
} from "./lend.machine";
import { MovementHistory } from "./MovementHistory";
import { PositionCard } from "./PositionCard";
import { TradeForm } from "./TradeForm";

type PositionView = { status: "loading" } | { status: "ready"; position: LenderPosition } | { status: "error"; message: string };

/** Position et fonds ; une relecture garde les chiffres affichés jusqu'à la réponse. */
function useLenderData() {
  const [view, setView] = useState<PositionView>({ status: "loading" });
  const [fund, setFund] = useState<LendFund>();
  const reload = useCallback(() => {
    fetchPosition()
      .then((position) => setView({ status: "ready", position }))
      .catch((cause: unknown) => setView({ status: "error", message: cause instanceof Error ? cause.message : String(cause) }));
    fetchLendFund()
      .then(setFund)
      .catch(() => setFund(undefined));
  }, []);
  useEffect(reload, [reload]);
  return { view, fund, reload };
}

function depositExplanation(position: LenderPosition, fund: LendFund | undefined): string {
  switch (position.entry.route) {
    case "native":
      return "Subscription is open: your RLUSD go straight into the fund's vault, which issues your shares.";
    case "immediate":
      return `The fund is lending${fund === undefined ? "" : ` until ${formatDate(fund.redemptionStartsAt)}`}: Bari sells you shares from its own stock at the share price, in one atomic transaction.`;
    case null:
      return "The fund is repaying its lenders: deposits are closed. You can still withdraw.";
  }
}

function withdrawExplanation(position: LenderPosition): string {
  return position.exit.route === "immediate"
    ? `Bari buys your shares back now at the share price minus ${position.immediateExitDiscountPercent}%, in one atomic transaction. At maturity, you exit for free.`
    : "Your shares go back to the fund's vault at the share price, with no fee.";
}

export function LendPage({ user }: { user: AccountView }) {
  const { view, fund, reload } = useLenderData();
  const [state, dispatch] = useReducer(lendTransition, initialLendState);

  const run = (action: LendAction, call: () => Promise<Movement>): Promise<boolean> => {
    if (isBusy(state.operation)) return Promise.resolve(false);
    dispatch({ type: "SUBMIT", action });
    return call()
      .then((movement) => {
        dispatch({ type: "SUCCEEDED", movement });
        return true;
      })
      .catch((cause: unknown) => {
        dispatch({ type: "FAILED", ...orderFailure(cause) });
        return false;
      })
      .finally(reload);
  };

  // Compte géré : Bari exécute l'ordre ; wallet : Bari le prépare, Otsu le signe, Bari le soumet.
  const trade = (action: "deposit" | "withdraw", place: () => Promise<LenderOrderResponse>) =>
    run(action, () =>
      placeOrder({ place, sign: (tx) => signWithOtsu(otsuProvider(), tx), submit: submitOrder }, dispatch).then((response) =>
        tradeMovement(action, response),
      ),
    );

  let content;
  switch (view.status) {
    case "loading":
      content = <Notice kind="info">Reading your position on the XRP Ledger…</Notice>;
      break;
    case "error":
      content = (
        <section className="step">
          <Notice kind="error">{view.message}</Notice>
          <Button primary onClick={reload}>
            Try again
          </Button>
        </section>
      );
      break;
    case "ready": {
      const { position } = view;
      const shares = BigInt(position.shares);
      const entryCap = position.entry.bariCap;
      const exitCap = position.exit.bariCap;
      content = (
        <>
          <PositionCard
            position={position}
            operation={state.operation}
            onAddTestRlusd={() => void run("faucet", () => addTestRlusd().then(faucetMovement))}
          />
          <div className="lend-trade">
            <TradeForm
              action="deposit"
              title="Deposit"
              explanation={depositExplanation(position, fund)}
              label="Amount in RLUSD"
              hint={`Available: ${formatRlusdUnits(BigInt(position.rlusdBalance))}${entryCap === undefined ? "" : ` · Bari's share stock: ${formatRlusdUnits(BigInt(entryCap))}`}`}
              check={(input) => checkDeposit(position, input)}
              previewFacts={(preview) => [
                { label: "Route", value: ROUTE_LABELS[preview.route] },
                { label: "You pay", value: formatRlusdUnits(preview.rlusd) },
                { label: "Share price", value: formatSharePrice(position.sharePrice) },
                { label: "You receive", value: `About ${formatShares(preview.shares)} shares` },
              ]}
              submitLabel="Deposit"
              pendingLabel="Depositing…"
              primary
              operation={state.operation}
              onSubmit={(amount) => trade("deposit", () => deposit(amount))}
            />
            <TradeForm
              action="withdraw"
              title="Withdraw"
              explanation={withdrawExplanation(position)}
              label="Shares to sell"
              hint={`You hold ${formatShares(shares)} shares${exitCap === undefined ? "" : ` · Bari's reserve buys back up to ${formatShares(BigInt(exitCap))}`}`}
              check={(input) => checkWithdraw(position, input)}
              previewFacts={(preview) => [
                { label: "Route", value: ROUTE_LABELS[preview.route] },
                { label: "You sell", value: `${formatShares(preview.shares)} shares` },
                { label: "Value at the share price", value: formatRlusdUnits(preview.rlusd + preview.fee) },
                {
                  label: "Fee",
                  value: preview.fee === 0n ? "None" : `−${formatRlusdUnits(preview.fee)} (${position.immediateExitDiscountPercent}%)`,
                },
                { label: "You receive", value: `About ${formatRlusdUnits(preview.rlusd)}` },
              ]}
              submitLabel="Withdraw"
              pendingLabel="Withdrawing…"
              fill={
                shares === 0n
                  ? undefined
                  : {
                      label: BigInt(position.exit.max) < shares ? "As many as Bari buys back now" : "All my shares",
                      value: sharesInput(BigInt(position.exit.max)),
                    }
              }
              operation={state.operation}
              onSubmit={(amount) => trade("withdraw", () => withdraw(amount))}
            />
          </div>
          <FundCard position={position} fund={fund} />
          <MovementHistory history={state.history} />
        </>
      );
      break;
    }
  }

  return (
    <main className="app">
      <div className="section-head">
        <span className="kicker">Lend</span>
        <h1>Your position.</h1>
        <p className="lead">
          Your shares are a token on the XRP Ledger. Exit anytime: free at maturity, or now through Bari at −0.5%.
        </p>
      </div>
      {content}
      <AccountCard user={user} />
    </main>
  );
}
