// Champs du KYC léger d'un prêteur ou d'une entreprise, partagés par l'inscription par email et par wallet.
import type { WalletRole } from "../../../../src/api/contract";
import { Field } from "../../ui/Field";
import type { DraftField, FieldErrors, SignupDraft } from "./account.machine";

/** Pays de résidence proposés au prêteur : Union européenne, Espace économique européen, Suisse et Royaume-Uni. */
const COUNTRY_CODES = [
  "AT", "BE", "BG", "CH", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GB", "GR", "HR", "HU", "IE", "IS", "IT", "LI",
  "LT", "LU", "LV", "MT", "NL", "NO", "PL", "PT", "RO", "SE", "SI", "SK",
];
const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
const COUNTRIES = COUNTRY_CODES.map((code) => ({ code, name: regionNames.of(code) ?? code })).sort((a, b) =>
  a.name.localeCompare(b.name),
);

interface ProfileFieldsProps {
  role: WalletRole;
  draft: SignupDraft;
  errors: FieldErrors;
  update: <K extends DraftField>(field: K, value: SignupDraft[K]) => void;
}

export function ProfileFields({ role, draft, errors, update }: ProfileFieldsProps) {
  return role === "lender" ? (
    <>
      <Field label="Full name" error={errors.name}>
        <input autoComplete="name" value={draft.name} onChange={(event) => update("name", event.target.value)} />
      </Field>
      <Field label="Country of residence" error={errors.country}>
        <select value={draft.country} onChange={(event) => update("country", event.target.value)}>
          <option value="">Choose…</option>
          {COUNTRIES.map((country) => (
            <option key={country.code} value={country.code}>
              {country.name}
            </option>
          ))}
        </select>
      </Field>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={draft.riskAcknowledged}
          onChange={(event) => update("riskAcknowledged", event.target.checked)}
        />
        I understand my capital is at risk.
      </label>
      {errors.riskAcknowledged !== undefined && <p className="field-error">{errors.riskAcknowledged}</p>}
    </>
  ) : (
    <>
      <Field label="Company name" error={errors.company}>
        <input autoComplete="organization" value={draft.company} onChange={(event) => update("company", event.target.value)} />
      </Field>
      <Field label="VAT number" error={errors.vatNumber} hint="With its country code, as on your invoices.">
        <input value={draft.vatNumber} onChange={(event) => update("vatNumber", event.target.value)} />
      </Field>
    </>
  );
}
