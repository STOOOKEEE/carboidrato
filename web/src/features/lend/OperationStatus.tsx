// État d'une opération du prêteur sous son bouton : en cours, faite avec ses transactions, ou refusée avec la marche à suivre.
import { Details } from "../../ui/Details";
import { Notice } from "../../ui/Notice";
import { TxLink } from "../../ui/TxLink";
import { movementSummary, type LendAction, type Operation } from "./lend.machine";

const PENDING: Record<LendAction, string> = {
  faucet: "Sending test euros to your account…",
  deposit: "Buying fund shares on the XRP Ledger…",
  withdraw: "Selling your shares on the XRP Ledger…",
};

export function OperationStatus({ operation, action }: { operation: Operation; action: LendAction }) {
  switch (operation.status) {
    case "idle":
      return null;
    case "submitting":
      return operation.action === action ? <Notice kind="info">{PENDING[action]} About 10 seconds.</Notice> : null;
    case "failed":
      return operation.action === action ? (
        <div className="lend-status">
          <Notice kind="error">{operation.message}</Notice>
          <p className="muted small">Your figures above are up to date: check the amount and try again.</p>
        </div>
      ) : null;
    case "done": {
      const { movement } = operation;
      if (movement.action !== action) return null;
      return (
        <div className="lend-status" data-testid={`lend-done-${action}`}>
          <p className="lend-done">
            <span className="step-index">■</span> {movementSummary(movement)}. <TxLink hash={movement.hash} />
          </p>
          {movement.hashes.length > 1 && (
            <Details summary={`all ${movement.hashes.length} transactions`}>
              <ul className="tx-list">
                {movement.hashes.map((hash) => (
                  <li key={hash}>
                    <TxLink hash={hash} />
                  </li>
                ))}
              </ul>
            </Details>
          )}
        </div>
      );
    }
  }
}
