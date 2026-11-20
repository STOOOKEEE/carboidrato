import type { CheckResult } from "../../../src/api/contract";
import { CHECK_COPY } from "../copy";

/** Contrôles affichés un par un (décalage CSS), comme s'ils tombaient pendant l'analyse. */
export function ChecksList({ checks }: { checks: CheckResult[] }) {
  return (
    <ul className="checks">
      {checks.map((check, index) => {
        const copy = CHECK_COPY[check.id];
        return (
          <li key={check.id} className={check.ok ? "check ok" : "check fail"} style={{ animationDelay: `${index * 140}ms` }}>
            <span className="check-icon" aria-hidden="true">{check.ok ? "■" : "×"}</span>
            <span className="check-label">{copy.label}</span>
            <span className="check-detail">{check.ok ? copy.ok : copy.fail}</span>
          </li>
        );
      })}
    </ul>
  );
}
