// Ouverture d'un compte géré par rôle, sans réseau : transactions soumises dans l'ordre, credentials valables un an.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Wallet, type SubmittableTransaction, type TransactionMetadata } from "xrpl";
import type { AccountProfile } from "../accounts/userStore.js";
import { textToHex } from "../lib/encoding.js";
import { CREDENTIAL_TYPES } from "./kycCredentials.js";
import { makeProvisioner, type FundTokens } from "./onboarding.js";

const NOW_RIPPLE = 817_000_000;
const ONE_YEAR_S = 365 * 86_400;
const FUND: FundTokens = { assetId: "AA".repeat(24), shareMptId: "BB".repeat(24) };

const lender: AccountProfile = { role: "lender", profile: { name: "Alice Rossi", country: "IT" } };
const business: AccountProfile = {
  role: "business",
  profile: { company: "Marco Costruzioni S.r.l.", vatNumber: "IT01234567890" },
};
const publicBody: AccountProfile = { role: "public_body", profile: { ipaCode: "c_a662", name: "Comune di Bari" } };

interface Submitted {
  tx: SubmittableTransaction;
  signer: string;
}

function setup({ fundOpen } = { fundOpen: true }) {
  const issuer = Wallet.generate();
  const submitted: Submitted[] = [];
  const funded: string[] = [];
  const provision = makeProvisioner({
    submit: async (tx, wallet) => {
      submitted.push({ tx, signer: wallet.address });
      return { hash: `${submitted.length}`.padStart(64, "0"), result: "tesSUCCESS", meta: {} as TransactionMetadata };
    },
    fundAccount: async (wallet) => {
      funded.push(wallet.address);
    },
    kycIssuer: issuer,
    fund: () => (fundOpen ? FUND : undefined),
    now: () => NOW_RIPPLE,
  });
  return { issuer, submitted, funded, provision };
}

const SHA256_URI_PREFIX = textToHex("sha256:");

describe("makeProvisioner", () => {
  test("prêteur : compte financé, KYC_INVESTOR émis pour un an puis accepté, EURc et parts du Vault autorisés", async () => {
    const { issuer, submitted, funded, provision } = setup();
    const account = await provision(lender);
    assert.ok(account !== undefined);
    assert.equal(Wallet.fromSeed(account.seed).address, account.address);
    assert.deepEqual(funded, [account.address]);
    assert.deepEqual(
      submitted.map(({ tx, signer }) => [tx.TransactionType, signer]),
      [
        ["CredentialCreate", issuer.address],
        ["CredentialAccept", account.address],
        ["MPTokenAuthorize", account.address],
        ["MPTokenAuthorize", account.address],
      ],
    );
    const [create, accept, asset, shares] = submitted.map(({ tx }) => tx as unknown as Record<string, unknown>);
    assert.equal(create.Subject, account.address);
    assert.equal(create.CredentialType, textToHex(CREDENTIAL_TYPES.kycInvestor));
    assert.equal(create.Expiration, NOW_RIPPLE + ONE_YEAR_S);
    assert.ok(String(create.URI).startsWith(SHA256_URI_PREFIX));
    assert.equal(accept.Issuer, issuer.address);
    assert.equal(accept.CredentialType, textToHex(CREDENTIAL_TYPES.kycInvestor));
    assert.equal(asset.MPTokenIssuanceID, FUND.assetId);
    assert.equal(shares.MPTokenIssuanceID, FUND.shareMptId);
  });

  test("entreprise : compte financé, KYB_PME émis pour un an puis accepté, EURc autorisé", async () => {
    const { issuer, submitted, funded, provision } = setup();
    const account = await provision(business);
    assert.ok(account !== undefined);
    assert.deepEqual(funded, [account.address]);
    assert.deepEqual(
      submitted.map(({ tx, signer }) => [tx.TransactionType, signer]),
      [
        ["CredentialCreate", issuer.address],
        ["CredentialAccept", account.address],
        ["MPTokenAuthorize", account.address],
      ],
    );
    const [create, , asset] = submitted.map(({ tx }) => tx as unknown as Record<string, unknown>);
    assert.equal(create.Subject, account.address);
    assert.equal(create.CredentialType, textToHex(CREDENTIAL_TYPES.kybSme));
    assert.equal(create.Expiration, NOW_RIPPLE + ONE_YEAR_S);
    assert.ok(String(create.URI).startsWith(SHA256_URI_PREFIX));
    assert.equal(asset.MPTokenIssuanceID, FUND.assetId);
  });

  test("organisme public : aucun compte XRPL, aucune transaction", async () => {
    const { submitted, funded, provision } = setup();
    assert.equal(await provision(publicBody), undefined);
    assert.deepEqual(submitted, []);
    assert.deepEqual(funded, []);
  });

  test("sans fonds ouvert : refus avant toute transaction", async () => {
    const { submitted, funded, provision } = setup({ fundOpen: false });
    await assert.rejects(provision(lender), /fund/i);
    await assert.rejects(provision(business), /fund/i);
    assert.deepEqual(submitted, []);
    assert.deepEqual(funded, []);
  });
});
