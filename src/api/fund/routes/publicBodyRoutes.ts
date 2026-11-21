// Espace organisme public : ses clés d'attestation (signature dans son navigateur) et la recherche d'un fournisseur.

import type { FastifyInstance } from "fastify";
import { deriveDebtor } from "../../../zk/index.js";
import type { BusinessLookup, PublicBodyKeys } from "../../contract.js";
import { requireRole, sessionUser } from "../auth.js";
import type { ApiContext } from "../context.js";
import { HttpError } from "../errors.js";
import { vatParamsSchema, type VatParams } from "../schemas.js";

const HTTP_NOT_FOUND = 404;

export function registerPublicBodyRoutes(app: FastifyInstance, context: Pick<ApiContext, "users">): void {
  const publicBodyOnly = { preHandler: requireRole(context, "public_body") };

  app.get("/api/public-body/keys", publicBodyOnly, async (request): Promise<PublicBodyKeys> => {
    const { profile } = sessionUser(request, "public_body");
    const debtor = await deriveDebtor(profile.name);
    return {
      name: profile.name,
      ipaCode: profile.ipaCode,
      eddsaPrivateKey: debtor.eddsaPrivateKey.toString("hex"),
      hmacKey: debtor.hmacKey.toString("hex"),
      publicKey: { ax: debtor.publicKey.ax.toString(), ay: debtor.publicKey.ay.toString() },
    };
  });

  app.get<{ Params: VatParams }>(
    "/api/businesses/by-vat/:vat",
    { ...publicBodyOnly, schema: vatParamsSchema },
    async (request): Promise<BusinessLookup> => {
      const business = context.users.findBusinessByVat(request.params.vat);
      if (business?.account === undefined) {
        throw new HttpError(HTTP_NOT_FOUND, "No business with this VAT number is registered on Bari");
      }
      return { company: business.profile.company, vatNumber: business.profile.vatNumber, address: business.account.address };
    },
  );
}
