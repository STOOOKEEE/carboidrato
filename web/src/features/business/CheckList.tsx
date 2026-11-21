// Liste de contrôles ✓ / ✗ en texte, avec la raison d'un échec : ceux du navigateur et ceux de Bari.

export interface CheckItem {
  id: string;
  label: string;
  ok: boolean;
  detail?: string;
}

export function CheckList({ checks, testId }: { checks: readonly CheckItem[]; testId?: string }) {
  return (
    <ul className="checks" data-testid={testId}>
      {checks.map((check) => (
        <li key={check.id} className={check.ok ? "check" : "check fail"}>
          <span className="check-icon">{check.ok ? "✓" : "✗"}</span>
          <span className="check-label">{check.label}</span>
          <span className="check-detail">{check.detail ?? (check.ok ? "Passed" : "Failed")}</span>
        </li>
      ))}
    </ul>
  );
}
