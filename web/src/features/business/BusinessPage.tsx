// Espace entreprise `#/business` : fichier signé contrôlé dans la page, offre, « Get paid now » en direct, factures du compte.
import { useEffect, useReducer, useRef, type Dispatch } from "react";
import type { AccountView } from "../../../../src/api/contract";
import { DropZone } from "../../ui/DropZone";
import { StepCard } from "../../ui/StepCard";
import { AccountCard } from "../account/AccountCard";
import type { FundingState } from "../funding/funding.machine";
import { precheckInBrowser } from "../funding/sources";
import { fundingServices } from "./api";
import { nextFundingEvent } from "./business.effects";
import { businessTransition, initialBusinessState, isBusy, readSignedFile, type BusinessEvent, type BusinessState } from "./business.machine";
import { InvoicePanel } from "./InvoicePanel";
import { MyInvoices } from "./MyInvoices";
import { OfferCard } from "./OfferCard";

/**
 * Enchaîne les étapes du financement : chaque état actif lance son effet une seule fois (le double rendu de StrictMode
 * compris) ; la machine ignore un événement arrivé hors de son état.
 */
function useFundingRunner(state: BusinessState, dispatch: Dispatch<BusinessEvent>): void {
  const started = useRef<FundingState | undefined>(undefined);
  useEffect(() => {
    if (state.status !== "checked" || started.current === state.funding) return;
    started.current = state.funding;
    void nextFundingEvent(state.funding, fundingServices(state.file, state.precheck)).then((event) => {
      if (event !== undefined) dispatch({ type: "FUNDING", event });
    });
  }, [state, dispatch]);
}

/** Relue quand un certificat vient d'être émis (prêt accordé ou refusé). */
function invoicesVersion(state: BusinessState): string {
  if (state.status !== "checked") return "";
  const { funding } = state;
  return funding.status === "funded" || funding.status === "refused" ? funding.certificate.tokenId : "";
}

export function BusinessPage({ user }: { user: AccountView }) {
  const [state, dispatch] = useReducer(businessTransition, initialBusinessState);
  useFundingRunner(state, dispatch);

  const onFile = async (dropped: File) => {
    if (isBusy(state)) return;
    dispatch({ type: "FILE_DROPPED", fileName: dropped.name });
    const reading = readSignedFile(await dropped.text(), user.address ?? "");
    if (!reading.ok) {
      dispatch({ type: "FILE_REJECTED", message: reading.message });
      return;
    }
    try {
      dispatch({ type: "FILE_CHECKED", file: reading.file, precheck: await precheckInBrowser(reading.file) });
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      dispatch({ type: "FILE_REJECTED", message: `Bari could not check this invoice: ${cause} Drop it again in a moment.` });
    }
  };

  const rejected = state.status === "unreadable" || (state.status === "checked" && state.precheck.verdict === "rejected");
  return (
    <main className="app business">
      <div className="section-head">
        <span className="kicker">Business</span>
        <h1>Get paid now.</h1>
        <p className="lead">Your invoice never leaves this page. We only learn that it covers the advance.</p>
      </div>
      <StepCard index={1} title="Your signed invoice" done={state.status === "checked" && state.precheck.verdict === "eligible"}>
        <DropZone
          onFile={(dropped) => void onFile(dropped)}
          label="Choose the signed invoice file (.bari.json)"
          caption="Drop the signed invoice here"
          busy={isBusy(state)}
          danger={rejected}
          accept=".json,application/json"
        >
          <InvoicePanel state={state} />
        </DropZone>
      </StepCard>
      {state.status === "checked" && (
        <OfferCard
          precheck={state.precheck}
          funding={state.funding}
          custody={user.custody}
          onGetPaid={() => dispatch({ type: "FUNDING", event: { type: "PROVE" } })}
          onRetry={() => dispatch({ type: "FUNDING", event: { type: "RETRY" } })}
        />
      )}
      <MyInvoices version={invoicesVersion(state)} />
      <AccountCard user={user} />
    </main>
  );
}
