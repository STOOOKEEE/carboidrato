// Appels à l'API du fonds (Fastify, proxifiée par Vite vers `npm run api:fund`). Rien du témoin n'y part :
// le front ne lit que des données publiques et n'envoie que la preuve et ses signaux publics.

import type {
  AccountView,
  CertificateRequest,
  CertificateResponse,
  KybStatus,
  OfferSchedule,
  ProofParams,
  PublicBodyOption,
  PublicDebtor,
  RegistryLookup,
  SigninRequest,
  SigninResponse,
  SignupRequest,
  SignupResponse,
} from "../../src/api/contract";
import { parseJsonOrUndefined } from "./json";
import type { FundSnapshot } from "./landing/fundFigures";

function errorMessage(payload: unknown, status: number): string {
  if (typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string") {
    return payload.error;
  }
  return `Bari API unavailable (HTTP ${status}). Is \`npm run api:fund\` running?`;
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const payload = parseJsonOrUndefined(await response.text());
  if (!response.ok || payload === undefined) throw new Error(errorMessage(payload, response.status));
  return payload as T;
}

export const postJson = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const fetchDebtors = () => request<PublicDebtor[]>("/api/debtors");

export const fetchProofParams = () => request<ProofParams>("/api/proof/params");

export const lookupRegistration = (nullifier: string, account: string) =>
  request<RegistryLookup>(`/api/registry/${nullifier}?account=${encodeURIComponent(account)}`);

export const fetchKybStatus = (account: string) => request<KybStatus>(`/api/sme/kyb/${encodeURIComponent(account)}`);

export const fetchOffer = (dueDate: string) => request<OfferSchedule>(`/api/offer?dueDate=${encodeURIComponent(dueDate)}`);

/** Seules la preuve et ses signaux publics sont recopiés : aucun autre champ ne peut partir par mégarde. */
export const submitCertificate = ({ proof, publicSignals }: CertificateRequest) =>
  postJson<CertificateResponse>("/api/sme/certificate", { proof, publicSignals } satisfies CertificateRequest);

export const fetchFund = () => request<FundSnapshot>("/api/fund");

export const fetchPublicBodies = () => request<PublicBodyOption[]>("/api/public-bodies");

export const signUp = (body: SignupRequest) => postJson<SignupResponse>("/api/auth/signup", body);

export const signIn = (body: SigninRequest) => postJson<SigninResponse>("/api/auth/signin", body);

export async function signOutSession(): Promise<void> {
  const response = await fetch("/api/auth/signout", { method: "POST" });
  if (!response.ok) throw new Error(errorMessage(undefined, response.status));
}

const HTTP_UNAUTHORIZED = 401;

/** Compte de la session, `undefined` sans session valide. */
export async function fetchMe(): Promise<AccountView | undefined> {
  const response = await fetch("/api/me");
  if (response.status === HTTP_UNAUTHORIZED) return undefined;
  const payload = parseJsonOrUndefined(await response.text());
  if (!response.ok || payload === undefined) throw new Error(errorMessage(payload, response.status));
  return payload as AccountView;
}
