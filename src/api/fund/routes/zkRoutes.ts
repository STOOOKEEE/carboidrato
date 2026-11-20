// Artefacts du circuit servis en statique (le navigateur lance snarkjs.groth16.fullProve avec eux), valeurs
// publiques que la preuve doit lier, et entrée du circuit construite à partir d'une facture attestée.

import { createReadStream } from "node:fs";
import type { FastifyInstance } from "fastify";
import { FUND_VINTAGE } from "../../../config/cohort.js";
import { loanTerms } from "../../../lending/loanTerms.js";
import { CIRCUIT_WASM_PATH, PROVING_KEY_PATH, VERIFICATION_KEY_PATH } from "../../../zk/constants.js";
import { parseAttestedInvoice } from "../../attestedInvoice.js";
import type { ProofParams } from "../../contract.js";
import { networkId, proofExpectations, type ApiContext } from "../context.js";
import { HttpError } from "../errors.js";
import { attestedInvoiceSchema } from "../schemas.js";
import { buildProveInput, toCircuitInput } from "../zkInputs.js";

const HTTP_NOT_FOUND = 404;
/** Les artefacts ne changent qu'avec un nouveau zk:setup : cache d'une heure. */
const ARTIFACT_CACHE_CONTROL = "public, max-age=3600";

export const ZK_ARTIFACTS_PREFIX = "/api/zk/";

const ARTIFACTS: Record<string, { path: string; contentType: string }> = {
  "bari_invoice.wasm": { path: CIRCUIT_WASM_PATH, contentType: "application/wasm" },
  "bari_invoice_final.zkey": { path: PROVING_KEY_PATH, contentType: "application/octet-stream" },
  "verification_key.json": { path: VERIFICATION_KEY_PATH, contentType: "application/json" },
};

function artifactUrls() {
  return Object.fromEntries(Object.keys(ARTIFACTS).map((name) => [name, `${ZK_ARTIFACTS_PREFIX}${name}`]));
}

export function registerZkRoutes(app: FastifyInstance, context: ApiContext): void {
  app.get("/api/zk", async () => artifactUrls());

  app.get("/api/proof/params", async (): Promise<ProofParams> => ({
    networkId: networkId(context),
    registry: context.actors.bari_registry.address,
    thresholdCents: loanTerms().provenThresholdCents.toString(),
    // Sans fonds ouvert, le millésime par défaut : celui que le prochain fonds publiera.
    vintage: context.store.current?.fund.manifest.vintage ?? FUND_VINTAGE,
    artifacts: {
      wasm: `${ZK_ARTIFACTS_PREFIX}bari_invoice.wasm`,
      zkey: `${ZK_ARTIFACTS_PREFIX}bari_invoice_final.zkey`,
      verificationKey: `${ZK_ARTIFACTS_PREFIX}verification_key.json`,
    },
  }));

  app.get<{ Params: { file: string } }>(`${ZK_ARTIFACTS_PREFIX}:file`, async (request, reply) => {
    const artifact = ARTIFACTS[request.params.file];
    if (artifact === undefined) throw new HttpError(HTTP_NOT_FOUND, `Artefact inconnu : ${request.params.file}`);
    return reply
      .type(artifact.contentType)
      .header("Cache-Control", ARTIFACT_CACHE_CONTROL)
      .send(createReadStream(artifact.path));
  });

  app.post("/api/sme/circuit-input", { schema: attestedInvoiceSchema }, async (request) => {
    const file = parseAttestedInvoice(request.body);
    const proveInput = await buildProveInput(file, proofExpectations(context));
    return {
      input: toCircuitInput(proveInput),
      artifacts: artifactUrls(),
    };
  });
}
