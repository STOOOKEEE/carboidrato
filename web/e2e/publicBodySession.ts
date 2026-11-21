// Session e2e d'un organisme public : le compte fixe de la Regione Puglia, inscrit au premier passage puis reconnecté.
// Jamais la Comune di Bari, réservée au pitch. Le cookie de session est celui du contexte de la page.

import { expect, type Page } from "@playwright/test";
import type { PublicBodyOption, SignupRequest } from "../../src/api/contract";

export const E2E_PUBLIC_BODY = {
  name: "Regione Puglia",
  email: "regione-puglia@e2e.example",
  password: "regione puglia e2e",
} as const;

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_CONFLICT = 409;

/** Ouvre la session de l'organisme e2e dans le contexte de `page` (inscription, ou connexion s'il existe déjà). */
export async function signInPublicBody(page: Page): Promise<void> {
  const bodies = (await (await page.request.get("/api/public-bodies")).json()) as PublicBodyOption[];
  const body = bodies.find(({ name }) => name === E2E_PUBLIC_BODY.name);
  expect(body, `${E2E_PUBLIC_BODY.name} is missing from the registry`).toBeDefined();
  const { email, password } = E2E_PUBLIC_BODY;
  const signup: SignupRequest = { email, password, role: "public_body", profile: { ipaCode: body?.ipaCode ?? "" } };
  const created = await page.request.post("/api/auth/signup", { data: signup });
  if (created.status() === HTTP_CREATED) return;
  expect(created.status(), await created.text()).toBe(HTTP_CONFLICT);
  const signedIn = await page.request.post("/api/auth/signin", { data: { email, password } });
  expect(signedIn.status(), `${E2E_PUBLIC_BODY.name} belongs to another account: ${await signedIn.text()}`).toBe(HTTP_OK);
}
