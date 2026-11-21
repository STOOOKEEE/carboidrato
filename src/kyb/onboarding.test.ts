// Ouverture d'un compte par rôle, sans réseau : compte géré (transactions soumises dans l'ordre, credentials valables
// un an) ou wallet de l'utilisateur (transactions qu'il signe lui-même, seules ou en un Batch).

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BatchFlags, GlobalFlags, Wallet, type Batch, type LedgerEntry, type SubmittableTransaction, type TransactionMetadata } from "xrpl";
import type { AccountProfile } from "../accounts/userStore.js";
import { textToHex } from "../lib/encoding.js";
import { FakeLedger } from "../xrpl/fakeLedger.js";
import { RLUSD_CURRENCY, type Stablecoin } from "../xrpl/stablecoin.js";
import { CREDENTIAL_TYPES } from "./kycCredentials.js";
import {
  credentialOffer,
  makeProvisioner,
  missingHoldings,
  userSteps,
  userTransaction,
  type FundTokens,
} from "./onboarding.js";

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
    return { LedgerEntryType: "MPToken", Account: account, MPTokenIssuanceID: FUND.shareMptId.toLowerCase() } as unknown as LedgerEntry.LedgerEntry;
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
    } as unknown as LedgerEntry.LedgerEntry);
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

describe("compte wallet : ce que Bari émet et ce que l'utilisateur signe", () => {
  const issuer = Wallet.generate().address;
  const holder = Wallet.generate().address;
  const trust: SubmittableTransaction = { TransactionType: "TrustSet", Account: holder, LimitAmount: { ...FUND.stablecoin, value: "1" } };
  const shares: SubmittableTransaction = { TransactionType: "MPTokenAuthorize", Account: holder, MPTokenIssuanceID: FUND.shareMptId };

  function credential(accepted: boolean): LedgerEntry.Credential {
    return { Flags: accepted ? 0x00010000 : 0 } as unknown as LedgerEntry.Credential;
  }

  test("credentialOffer : KYC_INVESTOR ou KYB_PME de l'émetteur, un an, URI = haché du dossier", () => {
    const offer = credentialOffer(issuer, holder, lender, NOW_RIPPLE);
    assert.equal(offer.TransactionType, "CredentialCreate");
    assert.equal(offer.Account, issuer);
    assert.equal(offer.Subject, holder);
    assert.equal(offer.CredentialType, textToHex(CREDENTIAL_TYPES.kycInvestor));
    assert.equal(offer.Expiration, NOW_RIPPLE + ONE_YEAR_S);
    assert.ok(String(offer.URI).startsWith(SHA256_URI_PREFIX));
    assert.equal(credentialOffer(issuer, holder, business, NOW_RIPPLE).CredentialType, textToHex(CREDENTIAL_TYPES.kybSme));
  });

  test("userSteps : acceptation du credential s'il ne l'est pas, puis les jetons manquants, avec leurs libellés", () => {
    const steps = userSteps(issuer, holder, "lender", credential(false), [trust, shares]);
    assert.deepEqual(
      steps.map(({ tx, label }) => [tx.TransactionType, label]),
      [
        ["CredentialAccept", "Accept your KYC credential"],
        ["TrustSet", "Open your RLUSD trust line"],
        ["MPTokenAuthorize", "Authorize vault shares"],
      ],
    );
    const accept = steps[0]?.tx as unknown as Record<string, unknown>;
    assert.deepEqual([accept.Account, accept.Issuer, accept.CredentialType], [holder, issuer, textToHex(CREDENTIAL_TYPES.kycInvestor)]);
    assert.equal(userSteps(issuer, holder, "business", undefined, [])[0]?.label, "Accept your KYB credential");
    assert.deepEqual(userSteps(issuer, holder, "lender", credential(true), []), []);
  });

  test("userTransaction : une seule transaction reste seule, séquence et échéance fixées", () => {
    assert.deepEqual(userTransaction(holder, [trust], 12, 500), { ...trust, Sequence: 12, LastLedgerSequence: 500 });
  });

  test("userTransaction : plusieurs transactions → un Batch tfAllOrNothing du seul compte, séquences à la suite", () => {
    const batch = userTransaction(holder, [trust, shares], 12, 500) as Batch;
    assert.equal(batch.TransactionType, "Batch");
    assert.equal(batch.Account, holder);
    assert.equal(batch.Flags, BatchFlags.tfAllOrNothing);
    assert.equal(batch.Sequence, 12);
    assert.equal(batch.LastLedgerSequence, 500);
    assert.equal(batch.BatchSigners, undefined);
    assert.deepEqual(
      batch.RawTransactions.map(({ RawTransaction }) => RawTransaction),
      [
        { ...trust, Flags: GlobalFlags.tfInnerBatchTxn, Fee: "0", SigningPubKey: "", Sequence: 13 },
        { ...shares, Flags: GlobalFlags.tfInnerBatchTxn, Fee: "0", SigningPubKey: "", Sequence: 14 },
      ],
    );
  });

  test("userTransaction : rien à signer → erreur", () => {
    assert.throws(() => userTransaction(holder, [], 12, 500));
  });
});
