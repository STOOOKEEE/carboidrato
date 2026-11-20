import { useRef, useState, type DragEvent } from "react";
import type { PrecheckResponse } from "../../../src/api/contract";
import { DitherCanvas } from "../dither/DitherCanvas";
import type { ShapeName } from "../dither/shapes";
import { Button } from "../ui/Button";
import { ResultPanel } from "./ResultPanel";
import { useInvoiceCheck, type CheckState } from "./useInvoiceCheck";

const SAMPLES = [
  { name: "invoice-valid", label: "Valid invoice" },
  { name: "invoice-forged", label: "Forged amount" },
  { name: "invoice-already-financed", label: "Already financed" },
  { name: "invoice-unknown-debtor", label: "Unknown debtor" },
] as const;

const ANALYSIS_STEPS = [
  "Recomputing your client's signature",
  "Looking up the verified-debtor list",
  "Searching the XRPL registry for its fingerprint",
  "Pricing your advance",
];

function visualFor(state: CheckState, dragging: boolean): { shape: ShapeName; danger: boolean } {
  if (dragging) return { shape: "invoice", danger: false };
  switch (state.stage) {
    case "idle":
      return { shape: "upload", danger: false };
    case "analyzing":
    case "unattested":
      return { shape: "invoice", danger: false };
    case "result":
      return state.result.verdict === "eligible" ? { shape: "euro", danger: false } : { shape: "cross", danger: true };
    case "error":
      return { shape: "cross", danger: true };
  }
}

interface InvoiceCheckerProps {
  onEligible?: (result: PrecheckResponse) => void;
  showCta?: boolean;
}

export function InvoiceChecker({ onEligible, showCta = true }: InvoiceCheckerProps) {
  const { state, checkFile, checkSample, reset } = useInvoiceCheck(onEligible);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = state.stage === "analyzing";
  const visual = visualFor(state, dragging);

  const onDragOver = (event: DragEvent) => {
    event.preventDefault();
    if (!busy) setDragging(true);
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file !== undefined && !busy) void checkFile(file);
  };
  const browse = () => {
    if (!busy) inputRef.current?.click();
  };

  return (
    <div
      className={`checker${dragging ? " is-dragging" : ""}`}
      onDragOver={onDragOver}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <button type="button" className="checker-visual" onClick={browse} aria-label="Choose an invoice file" disabled={busy}>
        <DitherCanvas
          shape={visual.shape}
          scanning={busy}
          interactive
          cell={8}
          tone={visual.danger ? "danger" : "light"}
          className="checker-canvas"
        />
        <span className="checker-caption">{dragging ? "Release to check" : busy ? "Scanning…" : "Drop invoice here"}</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) void checkFile(file);
          event.target.value = "";
        }}
      />
      <div className="checker-panel" aria-live="polite">
        {state.stage === "idle" && (
          <div className="result">
            <h3 className="result-title">Drop your attested invoice</h3>
            <p className="muted">
              The <code>.bari.json</code> file your public-sector client signed for you. We check it is genuine, never
              financed, and tell you how much we can advance. Nothing is written on-chain.
            </p>
            <button type="button" className="button" onClick={browse}>
              Browse files
            </button>
            <p className="muted small">No invoice at hand? Try one:</p>
            <div className="chips">
              {SAMPLES.map((sample) => (
                <button key={sample.name} type="button" className="chip" onClick={() => void checkSample(sample.name)}>
                  {sample.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {state.stage === "analyzing" && (
          <div className="result">
            <span className="kicker">Checking</span>
            <h3 className="result-title mono">{state.fileName}</h3>
            <ul className="steps">
              {ANALYSIS_STEPS.map((step, index) => (
                <li key={step} style={{ animationDelay: `${index * 450}ms` }}>
                  {step}
                </li>
              ))}
            </ul>
          </div>
        )}
        {state.stage === "result" && <ResultPanel result={state.result} onReset={reset} showCta={showCta} />}
        {state.stage === "unattested" && (
          <div className="result">
            <span className="kicker kicker-danger">Not attested</span>
            <h3 className="result-title">This invoice isn't signed by your client yet</h3>
            <p className="muted">
              Bari only finances invoices your client has attested. Ask them to attest <span className="mono">{state.fileName}</span>{" "}
              (one click on their side), then drop the <code>.bari.json</code> here.
            </p>
            <Button variant="ghost" onClick={reset}>
              Try another invoice
            </Button>
          </div>
        )}
        {state.stage === "error" && (
          <div className="result">
            <span className="kicker kicker-danger">Error</span>
            <h3 className="result-title">We couldn't check this file</h3>
            <p className="muted">{state.message}</p>
            <Button variant="ghost" onClick={reset}>
              Try again
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
