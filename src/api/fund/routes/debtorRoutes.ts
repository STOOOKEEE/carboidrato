// Côté mairie (débiteur simulé) : attestation signée d'une facture ; liste des débiteurs vérifiés et chemin de Merkle.

import type { FastifyInstance } from "fastify";
import { isValidClassicAddress } from "xrpl";
import { DEMO_DEBTOR, VERIFIED_DEBTORS } from "../../../invoice/debtors.js";
import { normalizeInvoiceNumber, type Invoice } from "../../../invoice/invoice.js";
import { eurToCents } from "../../../lib/amounts.js";
import { attestInvoice, deriveDebtor, toHex32 } from "../../../zk/index.js";
import { toAttestedInvoiceFile } from "../../attestedInvoice.js";
import { networkId, type ApiContext } from "../context.js";
import { HttpError } from "../errors.js";
import { attestSchema, debtorPathSchema, type AttestBody, type DebtorPathQuery } from "../schemas.js";
import { debtorPath } from "../zkInputs.js";

const HTTP_BAD_REQUEST = 400;
const MS_PER_SECOND = 1_000;
const DEFAULT_DESCRIPTION = "Travaux publics (démo)";

function parseDueDate(raw: string): Date {
  const dueDate = new Date(raw);
  if (Number.isNaN(dueDate.getTime())) throw new HttpError(HTTP_BAD_REQUEST, `Échéance illisible : ${raw}`);
  if (dueDate.getTime() <= Date.now()) throw new HttpError(HTTP_BAD_REQUEST, "L'échéance doit être future");
  return dueDate;
}

function findDebtor(name: string | undefined) {
  const debtor = name === undefined ? DEMO_DEBTOR : VERIFIED_DEBTORS.find((candidate) => candidate.name === name);
  if (debtor === undefined) throw new HttpError(HTTP_BAD_REQUEST, `Débiteur inconnu : ${name}`);
  return debtor;
}

export function registerDebtorRoutes(app: FastifyInstance, context: ApiContext): void {
  app.post<{ Body: AttestBody }>("/api/debtor/attest", { schema: attestSchema }, async (request) => {
    const { invoiceNumber, amountEur, smeAccount, debtorName, description } = request.body;
    if (!isValidClassicAddress(smeAccount)) throw new HttpError(HTTP_BAD_REQUEST, "Compte PME : adresse XRPL invalide");
    const invoice: Invoice = {
      debtor: findDebtor(debtorName),
      number: invoiceNumber,
      issueDate: new Date(),
      dueDate: parseDueDate(request.body.dueDate),
      amountEur,
    };
    const attestation = await attestInvoice(await deriveDebtor(invoice.debtor.name), {
      account: smeAccount,
      amount: eurToCents(amountEur),
      dueDate: BigInt(Math.floor(invoice.dueDate.getTime() / MS_PER_SECOND)),
      invoiceNumber: normalizeInvoiceNumber(invoice),
      networkId: networkId(context),
      registry: context.actors.bari_registry.address,
    });
    return toAttestedInvoiceFile(
      {
        number: invoice.number,
        debtorName: invoice.debtor.name,
        description: description ?? DEFAULT_DESCRIPTION,
        issueDate: invoice.issueDate,
      },
      attestation,
    );
  });

  app.get("/api/debtors", async () => VERIFIED_DEBTORS);

  app.get<{ Querystring: DebtorPathQuery }>("/api/debtors/path", { schema: debtorPathSchema }, async (request) => {
    const debtor = await deriveDebtor(findDebtor(request.query.debtor).name);
    const { publicKey, leaf, root, path } = await debtorPath(debtor.publicKey);
    return {
      debtor: debtor.name,
      publicKey: { ax: publicKey.ax.toString(), ay: publicKey.ay.toString() },
      leaf: leaf.toString(),
      pathElements: path.pathElements.map(String),
      pathIndices: path.pathIndices,
      root: root.toString(),
      rootHex: toHex32(root),
    };
  });
}
