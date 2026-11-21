// Mouvements du prêteur pendant la session, chacun avec sa transaction sur le ledger.
import { TxLink } from "../../ui/TxLink";
import { movementSummary, ROUTE_LABELS, type LendAction, type Movement } from "./lend.machine";

const ACTION_LABELS: Record<LendAction, string> = { faucet: "Test RLUSD", deposit: "Deposit", withdraw: "Withdraw" };

export function MovementHistory({ history }: { history: Movement[] }) {
  return (
    <section className="step" data-testid="lend-history">
      <h2>Your movements</h2>
      {history.length === 0 ? (
        <p className="muted">
          Nothing yet in this session. Test RLUSD, deposits and withdrawals appear here, each with its transaction on the
          XRP Ledger.
        </p>
      ) : (
        <ul className="lend-history">
          {history.map((movement) => (
            <li key={movement.hash}>
              <span className="step-index">{ACTION_LABELS[movement.action]}</span>
              <span>
                {movementSummary(movement)}
                {movement.route !== undefined && <span className="muted small"> · {ROUTE_LABELS[movement.route]}</span>}
              </span>
              <TxLink hash={movement.hash} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
