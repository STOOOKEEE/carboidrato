// Appels de l'espace prêteur : position, RLUSD de test, dépôt et retrait par le compte géré de la session.

import type {
  LenderFaucetResponse,
  LenderPosition,
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
  postJson<LenderTradeResponse>("/api/lender/deposit", { amount: amount.toString() } satisfies LenderTradeRequest);

/** `shares` en unités de part. */
export const withdraw = (shares: bigint) =>
  postJson<LenderTradeResponse>("/api/lender/withdraw", { amount: shares.toString() } satisfies LenderTradeRequest);
