// Preuve et pré-contrôle dans le navigateur : la facture attestée ne quitte jamais la page, seule la preuve part.

import { expect, test, type APIRequestContext, type Request } from "@playwright/test";
import type { AttestedInvoiceFile, CertificateRequest } from "../../src/api/contract";
import type * as Api from "../src/api";
import type * as Sources from "../src/features/funding/sources";

const WITNESS_KEYS = ["amount", "amountCents", "uuid", "signature", "pathElements", "pathIndices", "blinding"];
const INVOICE_AMOUNT_EUR = 10_340;
const TERM_DAYS = 90;
const MS_PER_DAY = 86_400_000;
const HTTP_CREATED = 201;
const HTTP_NOT_FOUND = 404;
/** Modules du front servis par Vite en dev : chargés dans la page, là où la preuve doit être calculée. */
const PAGE_MODULES = { sources: "/src/features/funding/sources.ts", api: "/src/api.ts" };

async function attestInvoice(request: APIRequestContext): Promise<AttestedInvoiceFile> {
  const actors = (await (await request.get("/api/actors")).json()) as { name: string; address: string }[];
  const sme = actors.find((actor) => actor.name === "sme");
  expect(sme).toBeDefined();
  const response = await request.post("/api/debtor/attest", {
    data: {
      invoiceNumber: `FT-E2E/${Date.now().toString(36)}`,
      amountEur: INVOICE_AMOUNT_EUR,
      dueDate: new Date(Date.now() + TERM_DAYS * MS_PER_DAY).toISOString(),
      smeAccount: sme?.address,
    },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()) as AttestedInvoiceFile;
}

function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...keysOf(child)]);
}

/** Aucune requête de la page ne transporte une valeur privée de l'attestation. */
function watchPrivateValues(requests: Request[], file: AttestedInvoiceFile) {
  const secrets = [file.attestation.uuid, file.attestation.signature.s, file.attestation.amountCents];
  return () => {
    for (const sent of requests) {
      const payload = `${sent.url()} ${sent.postData() ?? ""}`;
      for (const secret of secrets) expect(payload, sent.url()).not.toContain(secret);
    }
  };
}

test("le pré-contrôle de la landing tourne dans le navigateur", async ({ page, request }) => {
  const file = await attestInvoice(request);
  const requests: Request[] = [];
  page.on("request", (sent) => requests.push(sent));
  await page.goto("/");
  await page.locator(".checker input[type=file]").setInputFiles({
    name: "FT-2026-0815.bari.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(file)),
  });
  await expect(page.getByText("We can advance you")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("at least €10,000.00")).toBeVisible();
  expect(requests.some((sent) => sent.url().includes("/api/check"))).toBe(false);
  watchPrivateValues(requests, file)();
});

test("la preuve est calculée dans la page et seul { proof, publicSignals } part au serveur", async ({ page, request }) => {
  const file = await attestInvoice(request);
  const requests: Request[] = [];
  page.on("request", (sent) => requests.push(sent));
  await page.goto("/");

  const certificateRequest = page.waitForRequest(
    (sent) => sent.method() === "POST" && sent.url().endsWith("/api/sme/certificate"),
  );
  const outcome = await page.evaluate(
    async ({ attested, modules }) => {
      const sources = (await import(modules.sources)) as typeof Sources;
      const api = (await import(modules.api)) as typeof Api;
      const proof = await sources.proveInBrowser(attested);
      // Le statut de la réponse est vérifié plus bas, sur la requête interceptée.
      await api.submitCertificate(proof).catch(() => undefined);
      return { durationMs: proof.durationMs, publicSignals: proof.publicSignals };
    },
    { attested: file, modules: PAGE_MODULES },
  );

  expect(outcome.durationMs).toBeGreaterThan(0);
  expect(outcome.publicSignals).not.toContain(file.attestation.amountCents);

  const sent = await certificateRequest;
  const body = sent.postDataJSON() as CertificateRequest;
  expect(Object.keys(body).sort()).toEqual(["proof", "publicSignals"]);
  const sentKeys = keysOf(body);
  for (const key of WITNESS_KEYS) expect(sentKeys).not.toContain(key);
  // Sans fonds ouvert, l'API répond 404 ; avec un fonds, la preuve du navigateur est acceptée et certifiée.
  const response = await sent.response();
  expect([HTTP_CREATED, HTTP_NOT_FOUND]).toContain(response?.status());
  watchPrivateValues(requests, file)();
});
