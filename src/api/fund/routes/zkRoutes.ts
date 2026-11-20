// Artefacts du circuit servis en statique (le navigateur lance snarkjs.groth16.fullProve avec eux) et entrée du
// circuit construite à partir d'une facture attestée.

import { createReadStream } from "node:fs";
import type { FastifyInstance } from "fastify";
import { CIRCUIT_WASM_PATH, PROVING_KEY_PATH, VERIFICATION_KEY_PATH } from "../../../zk/constants.js";
import { parseAttestedInvoice } from "../../attestedInvoice.js";
import { proofExpectations, type ApiContext } from "../context.js";
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
