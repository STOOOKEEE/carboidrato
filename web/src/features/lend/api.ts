// Appels de l'espace prêteur : position, RLUSD de test, dépôt et retrait (exécutés par Bari pour un compte géré,
// préparés pour une signature dans Otsu pour un wallet), soumission de l'ordre signé.

import type {
  LenderFaucetResponse,
  LenderOrderResponse,
  LenderPosition,
  LenderSubmitRequest,
  LenderTradeRequest,
  LenderTradeResponse,
} from "../../../../src/api/contract";
import { postJson, request } from "../../api";
import type { LendFund } from "./lend.machine";

export const fetchPosition = () => request<LenderPosition>("/api/lender/position");

export const fetchLendFund = () => request<LendFund>("/api/fund");

export const addTestRlusd = () => postJson<LenderFaucetResponse>("/api/lender/faucet", {});

/** `amount` en unités RLUSD. */
export const deposit = (amount: bigint) =>
  postJson<LenderOrderResponse>("/api/lender/deposit", { amount: amount.toString() } satisfies LenderTradeRequest);

/** `shares` en unités de part. */
export const withdraw = (shares: bigint) =>
  postJson<LenderOrderResponse>("/api/lender/withdraw", { amount: shares.toString() } satisfies LenderTradeRequest);

/** L'ordre préparé par Bari, signé dans Otsu. */
export const submitOrder = (txBlob: string) =>
  postJson<LenderTradeResponse>("/api/lender/submit", { tx_blob: txBlob } satisfies LenderSubmitRequest);
