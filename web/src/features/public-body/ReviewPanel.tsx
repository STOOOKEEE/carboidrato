// Panneau de la zone de dépôt : champs lus (ou formulaire), fournisseur retrouvé par son n° de TVA, « Confirm and sign ».
import type { SubmitEvent } from "react";
import { formatDate, formatEur } from "../../format";
import { Button } from "../../ui/Button";
import { Details } from "../../ui/Details";
import { Facts, type Fact } from "../../ui/Facts";
import { Field } from "../../ui/Field";
import { Notice } from "../../ui/Notice";
import {
  isEditable,
  pendingSupplierVat,
  signBlocker,
  type InvoiceField,
  type PublicBodyState,
  type SupplierState,
} from "./publicBody.machine";

type PanelState = Extract<PublicBodyState, { status: "review" | "signing" }>;

interface ReviewPanelProps {
  state: PanelState;
  onEdit: (field: InvoiceField, value: string) => void;
  onSign: () => void;
}

const SOURCE_NOTICES = {
  partial: "Some fields are missing from this FatturaPA. Complete them from the invoice.",
  other: "This file is not a FatturaPA. Type the fields from the invoice.",
} as const;

const SUPPLIER_VALUES: Record<Exclude<SupplierState["status"], "found" | "none">, string> = {
  looking: "Looking up…",
  unknown: "No Bari account yet",
  failed: "Not found",
};

/** Date AAAA-MM-JJ affichée à midi UTC : le même jour dans tous les fuseaux. */
const showDate = (isoDate: string) => formatDate(`${isoDate}T12:00:00Z`);

function supplierValue(state: PanelState): string {
  const { supplier } = state;
  if (supplier.status === "found") return supplier.business.company;
  if (supplier.status !== "none") return SUPPLIER_VALUES[supplier.status];
  return pendingSupplierVat(state) === undefined ? "Enter the VAT number" : SUPPLIER_VALUES.looking;
}

function invoiceFacts({ form }: PanelState): Fact[] {
  return [
    { label: "Supplier VAT", value: form.vatNumber },
    { label: "Invoice number", value: form.number },
    { label: "Issue date", value: showDate(form.issueDate) },
    { label: "Total", value: formatEur(Number(form.amount)) },
    { label: "Due date", value: showDate(form.dueDate) },
  ];
}

function InvoiceForm({ state, onEdit }: Omit<ReviewPanelProps, "onSign">) {
  const { form, errors } = state;
  const disabled = state.status === "signing";
  return (
    <>
      <Field label="Supplier VAT number" error={errors.vatNumber} hint="With its country code, e.g. IT01234567890">
        <input value={form.vatNumber} disabled={disabled} onChange={(event) => onEdit("vatNumber", event.target.value)} />
      </Field>
      <Field label="Invoice number" error={errors.number}>
        <input value={form.number} disabled={disabled} onChange={(event) => onEdit("number", event.target.value)} />
      </Field>
      <Field label="Issue date" error={errors.issueDate}>
        <input type="date" value={form.issueDate} disabled={disabled} onChange={(event) => onEdit("issueDate", event.target.value)} />
      </Field>
      <Field label="Total amount (EUR)" error={errors.amount} hint="VAT included, e.g. 10340.00">
        <input inputMode="decimal" value={form.amount} disabled={disabled} onChange={(event) => onEdit("amount", event.target.value)} />
      </Field>
      <Field label="Due date" error={errors.dueDate}>
        <input type="date" value={form.dueDate} disabled={disabled} onChange={(event) => onEdit("dueDate", event.target.value)} />
      </Field>
    </>
  );
}

function SupplierNotice({ supplier }: { supplier: SupplierState }) {
  switch (supplier.status) {
    case "found":
      return (
        <Details summary="supplier's XRPL account, bound by your signature">
          <p className="mono public-address">{supplier.business.address}</p>
        </Details>
      );
    case "unknown":
      return <Notice kind="error">This supplier has no Bari account yet. Ask them to sign up as a business.</Notice>;
    case "failed":
      return <Notice kind="error">Could not look up the supplier: {supplier.message}</Notice>;
    default:
      return null;
  }
}

export function ReviewPanel({ state, onEdit, onSign }: ReviewPanelProps) {
  const editable = isEditable(state);
  const blocker = signBlocker(state);
  const supplierFact: Fact = { label: "Supplier", value: supplierValue(state) };
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (blocker === undefined) onSign();
  };

  return (
    <form className="form public-panel" onSubmit={submit} noValidate>
      <p className="muted small mono public-file">{state.fileName}</p>
      {state.source !== "fatturapa" && <Notice kind="info">{SOURCE_NOTICES[state.source]}</Notice>}
      {editable && <InvoiceForm state={state} onEdit={onEdit} />}
      <Facts facts={editable ? [supplierFact] : [supplierFact, ...invoiceFacts(state)]} />
      <SupplierNotice supplier={state.supplier} />
      {state.signError !== undefined && <Notice kind="error">{state.signError}</Notice>}
      <Button type="submit" primary disabled={blocker !== undefined} reason={blocker ?? ""}>
        Confirm and sign
      </Button>
    </form>
  );
}
