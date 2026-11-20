// Pipeline de la simulation : lecture du fichier déposé, appel du pré-contrôle, durée minimale d'analyse
// (pour laisser le temps à l'animation de scan), puis mémorisation d'un résultat éligible pour l'app.

import { useCallback, useState } from "react";
import type { PrecheckResponse } from "../../../src/api/contract";
import { checkInvoice } from "../api";
import { parseJsonOrUndefined } from "../json";
import { savePrecheck } from "../session";

export type CheckState =
  | { stage: "idle" }
  | { stage: "analyzing"; fileName: string }
  | { stage: "result"; result: PrecheckResponse }
  | { stage: "unattested"; fileName: string }
  | { stage: "error"; message: string };

const MIN_ANALYSIS_MS = 2200;
const SAMPLES_PATH = "/samples/";
const SAMPLE_EXTENSION = ".bari.json";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function useInvoiceCheck(onEligible?: (result: PrecheckResponse) => void) {
  const [state, setState] = useState<CheckState>({ stage: "idle" });

  const run = useCallback(
    async (fileName: string, readContent: () => Promise<string>) => {
      setState({ stage: "analyzing", fileName });
      const minimumDuration = delay(MIN_ANALYSIS_MS);
      try {
        const invoice = parseJsonOrUndefined(await readContent());
        if (invoice === undefined) {
          await minimumDuration;
          setState({ stage: "unattested", fileName });
          return;
        }
        const result = await checkInvoice(invoice);
        await minimumDuration;
        if (result.verdict === "eligible") {
          savePrecheck(result);
          onEligible?.(result);
        }
        setState({ stage: "result", result });
      } catch (error) {
        await minimumDuration;
        setState({ stage: "error", message: error instanceof Error ? error.message : String(error) });
      }
    },
    [onEligible],
  );

  const checkFile = useCallback((file: File) => run(file.name, () => file.text()), [run]);

  const checkSample = useCallback(
    (name: string) =>
      run(`${name}${SAMPLE_EXTENSION}`, async () => {
        const response = await fetch(`${SAMPLES_PATH}${name}${SAMPLE_EXTENSION}`);
        // Vite renvoie index.html (200) pour un fichier absent : on exige du JSON.
        const isJson = response.headers.get("content-type")?.includes("json") ?? false;
        if (!response.ok || !isJson) throw new Error("Sample invoices missing: run `npm run samples`");
        return response.text();
      }),
    [run],
  );

  const reset = useCallback(() => setState({ stage: "idle" }), []);

  return { state, checkFile, checkSample, reset };
}
