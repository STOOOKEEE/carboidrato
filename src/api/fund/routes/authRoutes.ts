// Comptes : inscription (compte XRPL ouvert par Bari), connexion, déconnexion et compte de la session.

import type { FastifyInstance } from "fastify";
import { normalizeVat, type AccountProfile, type NewUser, type UserRecord } from "../../../accounts/userStore.js";
import { VERIFIED_DEBTORS } from "../../../invoice/debtors.js";
import type { AccountView, SigninRequest, SigninResponse, SignupRequest, SignupResponse } from "../../contract.js";
import { CLEARED_SESSION_COOKIE, currentUser, issueSession, sessionCookie } from "../auth.js";
import type { ApiContext } from "../context.js";
import { HttpError } from "../errors.js";
import { signinSchema, signupSchema } from "../schemas.js";

const HTTP_CREATED = 201;
const HTTP_NO_CONTENT = 204;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;

type AuthContext = Pick<ApiContext, "users" | "provisionAccount" | "operations">;

/** Le profil enregistré : sans la case de consentement, nom de l'organisme repris du registre. */
function accountProfile(request: SignupRequest): AccountProfile {
  switch (request.role) {
    case "lender":
      return { role: "lender", profile: { name: request.profile.name.trim(), country: request.profile.country } };
    case "business":
      return {
        role: "business",
        profile: { company: request.profile.company.trim(), vatNumber: normalizeVat(request.profile.vatNumber) },
      };
    case "public_body": {
      const { ipaCode } = request.profile;
      const debtor = VERIFIED_DEBTORS.find((candidate) => candidate.ipaCode === ipaCode);
      if (debtor === undefined) throw new HttpError(HTTP_BAD_REQUEST, `Unknown public body: ${ipaCode}`);
      return { role: "public_body", profile: { ipaCode, name: debtor.name } };
    }
  }
}

export function accountView(user: UserRecord): AccountView {
  const verification = user.role === "public_body" ? "verified public body registry" : "basic (self-declared)";
  const base = { email: user.email, verification, ...(user.account === undefined ? {} : { address: user.account.address }) } as const;
  switch (user.role) {
    case "lender":
      return { ...base, role: user.role, profile: user.profile };
    case "business":
      return { ...base, role: user.role, profile: user.profile };
    case "public_body":
      return { ...base, role: user.role, profile: user.profile };
  }
}

export function registerAuthRoutes(app: FastifyInstance, context: AuthContext): void {
  app.post<{ Body: SignupRequest }>("/api/auth/signup", { schema: signupSchema }, async (request, reply) => {
    const profile = accountProfile(request.body);
    const newUser: NewUser = { ...profile, email: request.body.email, password: request.body.password };
    // Refus avant toute transaction : un doublon n'ouvre pas de compte sur le ledger.
    context.users.assertAvailable(newUser);
    const { result: account, transactions } = await context.operations.run(`signup ${profile.role}`, () =>
      context.provisionAccount(profile),
    );
    const user = await context.users.create(newUser, account);
    const body: SignupResponse = { user: accountView(user), transactions };
    return reply
      .status(HTTP_CREATED)
      .header("set-cookie", sessionCookie(issueSession(context.users.sessionSecret, user.id)))
      .send(body);
  });

  app.post<{ Body: SigninRequest }>("/api/auth/signin", { schema: signinSchema }, async (request, reply) => {
    const user = await context.users.authenticate(request.body.email, request.body.password);
    if (user === undefined) throw new HttpError(HTTP_UNAUTHORIZED, "Wrong email or password");
    const body: SigninResponse = { user: accountView(user) };
    return reply.header("set-cookie", sessionCookie(issueSession(context.users.sessionSecret, user.id))).send(body);
  });

  app.post("/api/auth/signout", async (_request, reply) =>
    reply.status(HTTP_NO_CONTENT).header("set-cookie", CLEARED_SESSION_COOKIE).send(),
  );

  app.get("/api/me", async (request) => {
    const user = currentUser(context, request);
    if (user === undefined) throw new HttpError(HTTP_UNAUTHORIZED, "Sign in to continue");
    return accountView(user);
  });
}
