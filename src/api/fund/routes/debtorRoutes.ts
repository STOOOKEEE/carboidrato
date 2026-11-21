// Registre public des débiteurs vérifiés : liste (ordre des feuilles de l'arbre de Merkle) et chemin de Merkle.
// La facture est signée dans le navigateur de l'organisme public, jamais par ce serveur.

import type { FastifyInstance } from "fastify";
import { VERIFIED_DEBTORS } from "../../../invoice/debtors.js";
import { deriveDebtor, toHex32 } from "../../../zk/index.js";
import { HttpError } from "../errors.js";
import { debtorPathSchema, type DebtorPathQuery } from "../schemas.js";
import { debtorPath, publicDebtors } from "../zkInputs.js";

const HTTP_BAD_REQUEST = 400;

function findDebtor(name: string) {
  const debtor = VERIFIED_DEBTORS.find((candidate) => candidate.name === name);
  if (debtor === undefined) throw new HttpError(HTTP_BAD_REQUEST, `Débiteur inconnu : ${name}`);
  return debtor;
}

export function registerDebtorRoutes(app: FastifyInstance): void {
  app.get("/api/debtors", publicDebtors);

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
