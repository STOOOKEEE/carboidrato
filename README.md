# Bari: invoice financing with zero-knowledge proofs on the XRP Ledger

Bari lets the suppliers of Italian public bodies get paid now. Small businesses that work for the Italian public administration wait months to be paid (the CJEU condemned Italy for it in case C-122/18, 2020), and to advance the money a financer usually has to see the invoice, and therefore the business's clients. Double financing is real too: at First Brands (2025), USD 2.3 billion "simply vanished" according to a creditor. Bari is our take on the Tokenization of real-world assets: the public body confirms an invoice, the supplier turns it into a token that carries its own zero-knowledge proof on the XRP Ledger, and a vault funded by verified lenders advances 90% in seconds. The ledger refuses to finance the same invoice twice, and nobody but the two parties ever sees the invoice.

The numbers (from [`src/config/finance.ts`](src/config/finance.ts)): a 10,000 € invoice due in 90 days gives the business 8,955 € right away (90% advance minus a 45 € fee), for a total cost of 178.16 €, about 8.1% a year. Lenders earn about 5.9% a year on the money lent; Bari keeps 46.33 € per loan and its first-loss cover absorbs the first defaults.

## Demo

The product has three spaces with real accounts, plus a public Transparency page. It runs on the team's XRPL AlphaNet (a dedicated node with the Lending Protocol, Batch and the other amendments enabled). That network has no public explorer, so every transaction opens its own detail page inside the app (`#/tx/<hash>`), with the decoded proof.

1. **Landing** (`#/`): what Bari does, three doors ("Lend", "I'm a public body", "I'm owed an invoice") and a link to Transparency.
2. **Lender** (`#/lend`): sign-up with a light KYC (the `KYC_INVESTOR` credential is issued), "Add test euros", then a 5,000 EURc deposit; the fund's shares arrive as an MPT and the dashboard shows the position value and the variable yield.
3. **Business** (`#/business`): sign-up with a light KYB (company name, VAT number; the `KYB_PME` credential is issued). The space asks the business to have its client confirm the invoice on Bari.
4. **Public body** (`#/public`): the Comune di Bari signs in and drops the FatturaPA of invoice FT-2026-0815 (10,340 €, due in 90 days). The fields are read in the browser, the supplier is found by its VAT number, and "Confirm and sign" signs the invoice in the browser and downloads the signed file to send to the supplier.
5. **Business**: it drops the signed file; the check runs in the browser and the offer appears: 9,000 € now, proven threshold 10,000 €, the exact amount stays private.
6. **"Get paid now"**: the proof is computed in the browser (about a second), then the certificate (an atomic `Batch`: nullifier `N` recorded, invoice MPT issued with the proof, handed to Bari), Bari's checks, and the co-signed `LoanSet`: 8,955 € received. Each step links to its transaction detail.
7. Dropping the same file again shows "Already financed", with a link to the ledger record of `N`.
8. **Transparency** (`#/transparency`): every proof behind the fund is verified again in the visitor's browser, along with the uniqueness of each `N`, the exposure per debtor pseudonym `P`, the share value and the utilisation rate. This page is what makes the invoice tokens people can trust rather than take on faith.
9. **Lender**: "Withdraw" exits immediately: Bari buys the shares back at the current price minus 0.5% in an atomic `Batch`, and the EURc come back.

## How it works

```mermaid
flowchart LR
  PB["Public body browser<br/>reads FatturaPA, signs (EdDSA)"] -->|signed .bari.json| SME["Business browser<br/>Groth16 proof"]
  SME -->|proof + public signals| API["Bari API<br/>checks proof, KYB, N, concentration"]
  API --> BATCH["Batch certificate<br/>credential N + invoice MPT<br/>(proof in MPTokenMetadata)"]
  BATCH --> LOAN["LoanSet co-signed<br/>LoanBroker of the Single Asset Vault"]
  LOAN -->|EURc advance| SME
  LENDERS["Lenders (KYC_INVESTOR)<br/>Permissioned Domain"] -->|VaultDeposit| VAULT["Vault shares (MPT)"]
  VAULT --- LOAN
  ANY["Anyone: #/transparency"] -->|verifies every proof| BATCH
```

This proof is the Crypto Vision of the project. The circuit ([`circuits/src/bari_invoice.circom`](circuits/src/bari_invoice.circom)) answers each of the lender's risks without revealing the invoice:

- **Authenticity**: the invoice carries a valid EdDSA-Poseidon signature by the debtor.
- **Verified debtor**: the debtor's key is a leaf of the Merkle tree of verified public bodies, whose root Bari publishes.
- **Uniqueness**: the nullifier `N` is derived from the invoice and the debtor's secret; it is recorded as a Credential on the ledger, and a second `CredentialCreate` for the same `N` fails with `tecDUPLICATE`.
- **Sufficiency**: the amount is at least the public threshold tier. Tiers are 5,000, 10,000, 20,000, 50,000 and 100,000 €; the advance is 90% of the largest tier not above the invoice, and only the tier becomes public.
- **Diversification**: the debtor pseudonym `P` lets Bari cap the exposure per debtor (20% of the fund) without naming it.
- **Accountability**: the proof is bound to the business's XRPL account, and the commitment `C = Poseidon(m, r)` ties it to the exact signed invoice, which the business can open later if asked.

Accounts are managed: Bari creates and holds the XRPL account of every user, so there is no wallet to install and no seed is ever shown. KYC and KYB are issued as Credentials: `KYC_INVESTOR` for lenders, accepted by their account, and required by the Permissioned Domain that gates the private vault; `KYB_PME` for businesses, checked by Bari before every advance. Each credential expires after one year.

Privacy: the invoice never leaves the browsers of the public body and of the supplier. Bari's server receives the proof and its public signals, plus two lookups that carry no amount: VAT number → supplier account, and `N` → already recorded or not. Proving everything a lender needs while keeping the invoice private is the other half of that Crypto Vision.

Effectiveness, in practice: tokenization is the core of the product (the invoice MPT carries its proof, the fund's shares are Multi-Purpose Tokens held by lenders), and the fund, the loans, the access rules and the double-financing guard are native ledger objects rather than a smart contract of our own. Invoices on public bodies are plain real-world assets; what changes is that each token carries verifiable value: its proof can be read from the ledger and checked by anyone.

## Built with

Every piece of ledger logic uses a native XRPL feature, which is where the Effectiveness of the design comes from:

- **Multi-Purpose Tokens**: the EURc stablecoin ([`src/setup/stablecoin.ts`](src/setup/stablecoin.ts)) and the invoice token, whose proof sits in its metadata so that anyone holding it has tokens people can trust ([`src/invoice/invoiceToken.ts`](src/invoice/invoiceToken.ts), [`src/invoice/certificateMetadata.ts`](src/invoice/certificateMetadata.ts)); vault shares are MPTs too.
- **Single Asset Vault (XLS-65)**: the lenders' fund, [`src/setup/vault.ts`](src/setup/vault.ts).
- **Lending Protocol (XLS-66)**: LoanBroker and co-signed `LoanSet`, [`src/lending/loan.ts`](src/lending/loan.ts).
- **Credentials (XLS-70)**: KYC/KYB in [`src/kyb/`](src/kyb/), the nullifier registry in [`src/invoice/registry.ts`](src/invoice/registry.ts).
- **Permissioned Domains**: vault access for KYC'd lenders, [`src/setup/lenderDomain.ts`](src/setup/lenderDomain.ts).
- **Batch**: atomic certificate and instant lender entry/exit, [`src/xrpl/batch.ts`](src/xrpl/batch.ts).
- **Groth16 circuit**: [`circuits/src/bari_invoice.circom`](circuits/src/bari_invoice.circom).
- **In-browser prover**: [`web/src/features/funding/`](web/src/features/funding/).
- **Transparency verifier**: re-checks every proof of the fund in the visitor's browser, so the verifiable value is not just Bari's word, [`web/src/features/transparency/`](web/src/features/transparency/).

Stack: Node 22 and TypeScript, xrpl.js 5.4 beta, circom 2.2.2, snarkjs 0.7.6, Fastify, React 19 + Vite.

## Run locally

The proving key is versioned (`circuits/build/bari_invoice_final.zkey`), so there is no trusted setup to run.

```sh
npm ci
```

Network selection comes from environment variables, read by [`src/config/network.ts`](src/config/network.ts):

- `XRPL_WS`: WebSocket URL of the node.
- `XRPL_GENESIS_SEED`: seed of a funded wallet used to fund new accounts on a node without faucet (keep it out of the repo).
- `XRPL_WALLETS_FILE`: local file where the fund's wallets are stored.

Without them, Bari targets the public XRPL devnet, funds accounts through its faucet and stores wallets in `.wallets.devnet.json`. Note that devnet does not have every amendment our node enables.

```sh
npm run demo:fund   # create or reuse the fund, its accounts and the history loans
npm run api:fund    # API on 127.0.0.1:8788
npm run web         # front on http://localhost:5173
```

Tests: `npm test` (unit and integration), `npx playwright test` (end-to-end, against a live network). Public audit of a fund from the ledger alone: `npm run audit -- <Vault or LoanBroker ID>`.

## Known limitations

- KYC and KYB are self-declared ("Verification: basic"); a regulated KYC provider could issue the same credentials without changing the vault or the checks.
- XRPL accounts are custodied by Bari.
- The public bodies' attestation keys are derived from a public secret (`DEMO_DEBTOR_SECRET` in [`src/zk/constants.ts`](src/zk/constants.ts)) and served to that body's session only. In production each body would keep its own keys.
- The vault is closed during the lending period (the ledger requires it for a LoanBroker), so immediate entry and exit go through Bari's share stock and EURc reserve.
- The Groth16 setup has 2 contributions and a demo beacon; it is not a production ceremony.
- The proof is verified off-ledger, by Bari and by anyone on the Transparency page, not by the ledger itself.
- Everything runs on a test network.

## AI disclosure

We used Claude Code with Claude models (Anthropic) as a coding assistant throughout the project.

- **Solution design and code generation**: the idea, the product design, the core architecture and the circuit come from the team, which built the first version of the ledger flow and the circuit before the event (see the git history from 20/11) and directed every change. Large parts of the code, including the XRPL integration, the API, the front end, the unit tests and the Playwright end-to-end tests, were written with the AI assistant under the team's direction and review.
- **Documentation**: this README, the specs and the internal docs were drafted with AI assistance and edited by the team.
- **Pitch preparation**: the pitch script was drafted with AI assistance and reviewed by the team.
