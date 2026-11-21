// Espace organisme public `#/public` : FatturaPA lue et attestation signée dans le navigateur ; seul le n° de TVA part.
import { useEffect, useReducer } from "react";
import type { AccountView } from "../../../../src/api/contract";
import { DropZone } from "../../ui/DropZone";
import { Notice } from "../../ui/Notice";
import { AccountCard } from "../account/AccountCard";
import { findSupplier, signInvoice } from "./api";
import { readFatturaPA } from "./fatturaPA";
import {
  downloadName,
  initialState,
  pendingSupplierVat,
  publicBodyTransition,
  validateForm,
  type InvoiceField,
} from "./publicBody.machine";
import { ReviewPanel } from "./ReviewPanel";
import { saveSignedPdf, SignedCard } from "./SignedCard";

/** Pause après la dernière frappe dans le n° de TVA, avant de le rechercher. */
const LOOKUP_DELAY_MS = 300;
const SAMPLES = ["FT-2026-0815", "FT-2026-0816", "FT-2026-0817"];

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

function EmptyPanel({ refusal }: { refusal?: string }) {
  return (
    <div className="public-panel">
      <h2>Drop the FatturaPA of an invoice addressed to you.</h2>
      {refusal !== undefined && <Notice kind="error">{refusal}</Notice>}
      <p className="muted">
        Its fields are read in this page. Any other file opens a form to type them from the invoice.
      </p>
      <p className="muted small">
        Sample FatturaPA, addressed to Comune di Bari:{" "}
        {SAMPLES.map((number, index) => (
          <span key={number}>
            {index > 0 && " · "}
            <a className="link" href={`/samples/${number}.xml`} download>
              {number}
            </a>
          </span>
        ))}
      </p>
    </div>
  );
}

export function PublicBodyPage({ user }: { user: AccountView }) {
  const [state, dispatch] = useReducer(publicBodyTransition, initialState);
  const vat = pendingSupplierVat(state);

  useEffect(() => {
    if (vat === undefined) return;
    const timer = setTimeout(() => {
      dispatch({ type: "LOOKUP_STARTED", vat });
      findSupplier(vat)
        .then((business) => dispatch({ type: "LOOKUP_DONE", vat, business }))
        .catch((cause: unknown) => dispatch({ type: "LOOKUP_FAILED", vat, message: messageOf(cause) }));
    }, LOOKUP_DELAY_MS);
    return () => clearTimeout(timer);
  }, [vat]);

  const onFile = (file: File) => {
    file
      .text()
      .then((text) => dispatch({ type: "FILE_READ", fileName: file.name, reading: readFatturaPA(text) }))
      // Fichier illisible comme texte : la facture se saisit à la main.
      .catch(() => dispatch({ type: "FILE_READ", fileName: file.name, reading: { ok: false, reason: "not-fatturapa" } }));
  };

  const onEdit = (field: InvoiceField, value: string) => dispatch({ type: "EDIT", field, value });

  const onSign = () => {
    if (state.status !== "review") return;
    const validation = validateForm(state.form, state.description);
    dispatch({ type: "SIGN", validation: validation.ok ? { ok: true } : validation });
    if (!validation.ok || state.supplier.status !== "found") return;
    const supplier = state.supplier.business;
    signInvoice(validation.draft, supplier)
      .then((file) => {
        dispatch({ type: "SIGNED", file });
        return saveSignedPdf(file, supplier, downloadName(file.invoice.number));
      })
      .catch((cause: unknown) => dispatch({ type: "SIGN_FAILED", message: messageOf(cause) }));
  };

  return (
    <main className="app">
      <div className="section-head">
        <span className="kicker">Declare invoice</span>
        <h1>Confirm your suppliers' invoices.</h1>
        <p className="lead">Signed in your browser. Bari never receives this invoice.</p>
      </div>
      {state.status === "signed" ? (
        <SignedCard file={state.file} fileName={state.fileName} supplier={state.supplier} onAnother={() => dispatch({ type: "RESET" })} />
      ) : (
        <DropZone
          onFile={onFile}
          label="Choose an invoice file"
          caption="Drop a FatturaPA (.xml)"
          busy={state.status === "signing"}
        >
          {state.status === "empty" ? <EmptyPanel refusal={state.refusal} /> : <ReviewPanel state={state} onEdit={onEdit} onSign={onSign} />}
        </DropZone>
      )}
      <AccountCard user={user} />
    </main>
  );
}
