// Position du prêteur : valeur, parts, gain, rendement variable, euros disponibles et euros de test.
import type { LenderPosition } from "../../../../src/api/contract";
import { formatPercent } from "../../format";
import { Button } from "../../ui/Button";
import { formatEurUnits, formatShares, type Operation } from "./lend.machine";
import { OperationStatus } from "./OperationStatus";

interface PositionCardProps {
  position: LenderPosition;
  operation: Operation;
  onAddTestEuros: () => void;
}

export function PositionCard({ position, operation, onAddTestEuros }: PositionCardProps) {
  const shares = BigInt(position.shares);
  const balance = BigInt(position.eurcBalance);
  const gain = BigInt(position.gain);
  const busy = operation.status === "submitting";
  const mine = busy && operation.action === "faucet";
  const figures = [
    { id: "value", label: "Value", value: formatEurUnits(BigInt(position.value)) },
    { id: "shares", label: "Fund shares", value: formatShares(shares) },
    { id: "gain", label: "Gain", value: `${gain > 0n ? "+" : ""}${formatEurUnits(gain)}` },
    { id: "yield", label: "Variable yield", value: `${formatPercent(position.variableYieldPercent)} a year` },
  ];

  return (
    <section className="step" data-testid="lend-position">
      <h2>Your position</h2>
      <dl className="lend-figures">
        {figures.map((figure) => (
          <div key={figure.id}>
            <dt>{figure.label}</dt>
            <dd data-testid={`lend-${figure.id}`}>{figure.value}</dd>
          </div>
        ))}
      </dl>
      {shares === 0n && (
        <p className="muted">
          {balance === 0n
            ? "You have no shares yet. Add test euros, then deposit them in the fund."
            : "You have no shares yet. Deposit below to buy your first ones."}
        </p>
      )}
      <div className="lend-wallet">
        <div>
          <p className="muted small">Euros ready to deposit (EURc)</p>
          <p className="lend-balance" data-testid="lend-balance">
            {formatEurUnits(balance)}
          </p>
        </div>
        <div className="lend-faucet">
          <Button
            variant="ghost"
            onClick={onAddTestEuros}
            disabled={busy}
            reason={mine ? "Adding test euros…" : "One transaction at a time: wait for the current one to finish."}
          >
            {mine ? "Adding test euros…" : "Add test euros"}
          </Button>
          <p className="muted small">10,000 EURc, only on this test network.</p>
        </div>
      </div>
      <OperationStatus operation={operation} action="faucet" />
    </section>
  );
}
