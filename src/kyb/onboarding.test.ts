// Ouverture d'un compte géré par rôle, sans réseau : transactions soumises dans l'ordre, credentials valables un an.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Wallet, type LedgerEntry, type SubmittableTransaction, type TransactionMetadata } from "xrpl";
import type { AccountProfile } from "../accounts/userStore.js";
import { textToHex } from "../lib/encoding.js";
import { FakeLedger } from "../xrpl/fakeLedger.js";
import { RLUSD_CURRENCY, type Stablecoin } from "../xrpl/stablecoin.js";
import { CREDENTIAL_TYPES } from "./kycCredentials.js";
import { makeProvisioner, missingHoldings, type FundTokens } from "./onboarding.js";

const NOW_RIPPLE = 817_000_000;
const ONE_YEAR_S = 365 * 86_400;
const FUND: FundTokens = { stablecoin: { currency: RLUSD_CURRENCY, issuer: Wallet.generate().address }, shareMptId: "BB".repeat(24) };

const lender: AccountProfile = { role: "lender", profile: { name: "Alice Rossi", country: "IT" } };
const business: AccountProfile = {
  role: "business",
  profile: { company: "Marco Costruzioni S.r.l.", vatNumber: "IT01234567890" },
};
const publicBody: AccountProfile = { role: "public_body", profile: { ipaCode: "c_a662", name: "Comune di Bari" } };

interface Submitted {
  tx: SubmittableTransaction;
  signer: string;
  label: string;
}

/** Devise et émetteur de la ligne de confiance ouverte par un TrustSet. */
function trustedAsset(tx: Record<string, unknown>): Stablecoin {
  const { currency, issuer } = tx.LimitAmount as Stablecoin;
  return { currency, issuer };
}

function setup({ fundOpen } = { fundOpen: true }) {
  const issuer = Wallet.generate();
  const submitted: Submitted[] = [];
  const funded: string[] = [];
  const provision = makeProvisioner({
    submit: async (tx, wallet, label) => {
      submitted.push({ tx, signer: wallet.address, label });
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
  test("prêteur : compte financé, KYC_INVESTOR émis pour un an puis accepté, ligne de confiance RLUSD et parts du Vault autorisées", async () => {
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
        ["TrustSet", account.address],
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
    assert.deepEqual(trustedAsset(asset), FUND.stablecoin);
    assert.equal(shares.MPTokenIssuanceID, FUND.shareMptId);
    assert.deepEqual(
      submitted.slice(2).map(({ label }) => label),
      ["TrustSet RLUSD (lender)", "MPTokenAuthorize Vault shares (lender)"],
    );
  });

  test("entreprise : compte financé, KYB_PME émis pour un an puis accepté, ligne de confiance RLUSD", async () => {
    const { issuer, submitted, funded, provision } = setup();
    const account = await provision(business);
    assert.ok(account !== undefined);
    assert.deepEqual(funded, [account.address]);
    assert.deepEqual(
      submitted.map(({ tx, signer }) => [tx.TransactionType, signer]),
      [
        ["CredentialCreate", issuer.address],
        ["CredentialAccept", account.address],
        ["TrustSet", account.address],
      ],
    );
    const [create, , asset] = submitted.map(({ tx }) => tx as unknown as Record<string, unknown>);
    assert.equal(create.Subject, account.address);
    assert.equal(create.CredentialType, textToHex(CREDENTIAL_TYPES.kybSme));
    assert.equal(create.Expiration, NOW_RIPPLE + ONE_YEAR_S);
    assert.ok(String(create.URI).startsWith(SHA256_URI_PREFIX));
    assert.deepEqual(trustedAsset(asset), FUND.stablecoin);
    assert.equal(submitted[2]?.label, "TrustSet RLUSD (business)");
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

describe("missingHoldings", () => {
  const holder = Wallet.generate().address;

  function trustLineEntry(asset: Stablecoin, account: string) {
    return {
      LedgerEntryType: "RippleState",
      Balance: { currency: asset.currency, issuer: "rrrrrrrrrrrrrrrrrrrrBZbvji", value: "0" },
      HighLimit: { currency: asset.currency, issuer: account, value: "1000000000" },
      LowLimit: { currency: asset.currency, issuer: asset.issuer, value: "0" },
    } as unknown as LedgerEntry.RippleState;
  }

  function shareHolding(account: string) {
    return { LedgerEntryType: "MPToken", Account: account, MPTokenIssuanceID: FUND.shareMptId.toLowerCase() } as unknown as LedgerEntry.MPToken;
  }

  test("prêteur ouvert avant le fonds courant : ligne de confiance RLUSD et parts du nouveau Vault manquantes", async () => {
    const ledger = new FakeLedger(undefined);
    const missing = await missingHoldings(ledger, FUND, holder, "lender");
    assert.deepEqual(
      missing.map((tx) => [tx.TransactionType, tx.Account]),
      [
        ["TrustSet", holder],
        ["MPTokenAuthorize", holder],
      ],
    );
    assert.deepEqual(trustedAsset(missing[0] as unknown as Record<string, unknown>), FUND.stablecoin);
    assert.equal((missing[1] as unknown as Record<string, unknown>).MPTokenIssuanceID, FUND.shareMptId);
  });

  test("rien à soumettre quand la ligne de confiance et les parts sont déjà là", async () => {
    const ledger = new FakeLedger(undefined);
    ledger.putAccountObject(holder, "state", trustLineEntry(FUND.stablecoin, holder));
    ledger.putAccountObject(holder, "mptoken", shareHolding(holder));
    assert.deepEqual(await missingHoldings(ledger, FUND, holder, "lender"), []);
  });

  test("une ligne de confiance vers un autre émetteur ou des parts d'un ancien Vault ne comptent pas", async () => {
    const ledger = new FakeLedger(undefined);
    ledger.putAccountObject(holder, "state", trustLineEntry({ ...FUND.stablecoin, issuer: Wallet.generate().address }, holder));
    ledger.putAccountObject(holder, "mptoken", {
      LedgerEntryType: "MPToken",
      Account: holder,
      MPTokenIssuanceID: "CC".repeat(24),
    } as unknown as LedgerEntry.MPToken);
    assert.deepEqual(
      (await missingHoldings(ledger, FUND, holder, "lender")).map((tx) => tx.TransactionType),
      ["TrustSet", "MPTokenAuthorize"],
    );
  });

  test("entreprise : seule la ligne de confiance RLUSD compte", async () => {
    const ledger = new FakeLedger(undefined);
    assert.deepEqual(
      (await missingHoldings(ledger, FUND, holder, "business")).map((tx) => tx.TransactionType),
      ["TrustSet"],
    );
    ledger.putAccountObject(holder, "state", trustLineEntry(FUND.stablecoin, holder));
    assert.deepEqual(await missingHoldings(ledger, FUND, holder, "business"), []);
  });
});
