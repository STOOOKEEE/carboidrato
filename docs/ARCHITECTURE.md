# Architecture : la carte des composants

Un composant est un dossier de `src/` (et `web/` pour le front). Les composants sont rangés en couches, et un import ne descend jamais vers le haut. La carte est exécutable : `src/architecture.test.ts` la vérifie à chaque `npm test`.

## Règles

1. **Dépendances descendantes uniquement.** Un composant n'importe que des composants de couche strictement inférieure, ce qui exclut tout cycle. Un nouveau dossier dans `src/` doit être ajouté à `LAYERS` (dans `src/architecture.test.ts`) et à ce document, sinon `npm test` échoue.
2. **Le front ne connaît que le contrat.** `web/` n'importe du back que `src/api/contract.ts` (types partagés) ; tout le reste passe par HTTP.
3. **API publique.** Un composant n'utilise d'un autre que ce qui est listé dans le tableau ci-dessous. Chaque composant reçoit un `index.ts` quand on le passe en TDD ; `zk` en a déjà un.
4. **Entrées-sorties injectées.** Le code nouveau ou réécrit en TDD reçoit le ledger, le prouveur, l'horloge et l'état par des ports, pour être testé sans réseau. Le premier port, `Ledger` (voir plus bas), vit dans `xrpl/ledger.ts`.

## Couches

```mermaid
flowchart TB
  L9["9 · demo"] --> L8["8 · api"] --> L7["7 · audit · setup"] --> L6["6 · lending"] --> L5["5 · fund"] --> L4["4 · invoice · kyb"] --> L3["3 · accounts"] --> L2["2 · zk · xrpl"] --> L1["1 · lib"] --> L0["0 · config"]
  W["web (React)"] -. "types de contract.ts" .-> L8
```

Une flèche signifie « peut importer les couches en dessous », à n'importe quelle distance.

## Composants

| Couche | Composant | Rôle | Dépend de | API publique (utilisée par les autres) | Tests |
|---|---|---|---|---|---|
| 0 | `config` | paramètres financiers, calendrier de cohorte, réseau ; surchargeables par l'environnement | — | `finance.ts`, `cohort.ts`, `network.ts` | — |
| 1 | `lib` | montants, taux, encodages, journal | config | `amounts`, `rates`, `encoding`, `log`, `onLogEvent` | — |
| 2 | `zk` | attestation du débiteur, arbre de Merkle, preuve Groth16, vérification, encodage de la preuve pour les métadonnées | — | `zk/index.ts` ; `constants` et `field.randomField` sont encore importés directement par `api`, à faire passer par l'index | `zk.test.ts` (11 tests, exigent la zkey) |
| 2 | `xrpl` | adaptateur XRPL : soumission (port `SubmitTx`), `Batch`, lecture d'objets, heure du ledger, métadonnées, MPT ; port `Ledger` et son faux en mémoire | lib | `ledger`, `submit`, `batch`, `ledgerEntries`, `ledgerTime`, `meta`, `mpt` ; `fakeLedger` (tests seulement) | — |
| 3 | `accounts` | acteurs de la démo, wallets, financement des comptes ; comptes des utilisateurs (`userStore` : email, rôle, profil, haché `scrypt`, compte XRPL géré, secret de session, dans `.bari-state.<réseau>.users.json` ; port `ProvisionAccount`) | config, lib, xrpl | `actors`, `funding`, `userStore` | `userStore.test.ts` |
| 4 | `invoice` | certificat de facture : facture, attestation → preuve → métadonnées, registre `N`, MPT facture, émission en `Batch`, vérification de la preuve | config, lib, xrpl, zk | `certificate`, `certificateMetadata`, `debtors`, `invoice`, `invoiceToken`, `issueCertificate`, `proofVerification`, `registry` | — |
| 4 | `kyb` | identité : credentials KYC/KYB (émission et acceptation, expiration), KYB de la PME de démo, ouverture du compte géré par rôle (`onboarding` : compte financé, `KYC_INVESTOR` ou `KYB_PME` d'un an, `MPTokenAuthorize` de l'EURc et des parts) | accounts, lib, xrpl | `kycCredentials`, `smeKyb`, `onboarding` | `onboarding.test.ts` (faux `SubmitTx`) |
| 5 | `fund` | modèle du fonds (`Fund`, `Cohort`), fiche publique du Vault, `Data` du `LoanSet`, lecture des prêts, inspection d'un certificat, concentration par `P` | config, invoice, lib, xrpl | `fund`, `fundManifest`, `loanData`, `loanRecords`, `invoiceInspection`, `concentration` | — |
| 6 | `lending` | conditions et économie du prêt, contrôles de Bari avant co-signature, `LoanSet`, remboursement, défaut, souscription, rachat | accounts, config, fund, invoice, kyb, lib, xrpl | `loan`, `loanTerms`, `economics`, `repayment`, `defaultFlow`, `subscription`, `redemption` | `loanTerms.test.ts`, `loanChecks.test.ts` (faux `Ledger`, exige la zkey) |
| 7 | `audit` | audit public du fonds, depuis le ledger seul | config, fund, invoice, lib, xrpl, zk | `auditFund` | — |
| 7 | `setup` | mise en place du fonds : stablecoin, domaine des prêteurs, Vault fermé, LoanBroker | accounts, config, fund, invoice, kyb, lending, lib, xrpl | `setupFund` | — |
| 8 | `api` | un serveur Fastify (port 8788 : comptes et sessions, fonds, lectures publiques du pré-contrôle, paramètres de la preuve, certificat, prêt, audit, détail de transaction, SSE) ; `auth.ts` = cookie de session signé HMAC et garde `requireRole` (401 sans session, 403 pour un autre rôle) ; `contract.ts` = types partagés avec le front | toutes les couches inférieures | `contract.ts`, `attestedInvoice.ts` | `app.test.ts`, `routes/authRoutes.test.ts` (faux contexte `fakeContext.ts`, sans réseau), `offer.test.ts`, `routes/txRoutes.test.ts` (faux `Ledger`, exige la zkey) ; `npm run api:smoke` (devnet) |
| 9 | `demo` | scénarios en ligne de commande (`demo`, `demo:fund`, `samples`) ; étapes communes dans `financing.ts` | toutes les couches inférieures | — | `fundReuse.test.ts` ; `npm run demo` (devnet), `npm run demo:fund` (fonds durable repris par l'API) |
| — | `web` | front React/Vite : landing, KYB, pré-contrôle et preuve Groth16 calculés dans le navigateur (`features/funding`), détail de transaction | `src/api/contract.ts` | — | `features/**/*.test.ts` ; e2e Playwright (`web/e2e`) |

## Le port `Ledger`

Il couvre les lectures dont ont besoin `lending/loanChecks.ts`, `fund/invoiceInspection.ts`, `fund/loanRecords.ts`, `invoice/registry.ts` (`getRegistration`), `kyb/smeKyb.ts` (`isSmeKybDone`) et la route `GET /api/tx/:hash` (`ApiContext.ledger`), une méthode par commande rippled, toujours sur le ledger validé. L'adaptateur réel, `xrplLedger(client)`, vit dans `xrpl/ledger.ts` et enveloppe `Client` ; les tests utilisent `FakeLedger` (`xrpl/fakeLedger.ts`), un faux en mémoire.

```ts
export interface Ledger {
  networkId(): number | undefined;
  credential(subject: string, issuer: string, typeHex: string): Promise<LedgerEntry.Credential | undefined>;
  mptIssuance(id: string): Promise<LedgerEntry.MPTokenIssuance | undefined>;
  mptBalance(id: string, holder: string): Promise<bigint>;
  vault(id: string): Promise<LedgerEntry.Vault>; // lève une erreur si absent
  loanBroker(id: string): Promise<LedgerEntry.LoanBroker>; // lève une erreur si absent
  accountObjects(account: string, type: AccountObjectType): Promise<LedgerEntry.LedgerEntry[]>;
  transaction(hash: string): Promise<TxResponse["result"] | undefined>; // undefined si txnNotFound
}
```

`closeTime()`, prévu au départ, n'y est pas encore : aucun module migré ne lit l'heure du ledger. Il s'ajoutera avec le premier qui en aura besoin.

Il remplace le `Client` brut module par module, en commençant par ceux qu'on modifie ; les appelants qui ont encore un `Client` construisent l'adaptateur sur place (`xrplLedger(client)`).

**Unicité de `N` entre les fonds.** Avant de co-signer, Bari liste ses LoanBroker (`accountObjects(bari, "loan_broker")`), puis les prêts de chacun et la référence portée par leur `LoanSet` : un `N` déjà référencé par un prêt de n'importe quel fonds Bari est refusé, pas seulement dans le fonds courant.

## TDD

- **Où :** à côté du code, `src/<composant>/<module>.test.ts`. `npm test` lance tous les `src/**/*.test.ts` (node:test + tsx).
- **Cycle :** test rouge → code minimal → vert → refactorisation, un comportement à la fois.
- **Sans réseau :** `npm test` n'appelle jamais le devnet. On teste la logique pure, ou on utilise un faux `Ledger`.
- **Intégration :** `npm run api:smoke` et `npm run demo` sur devnet, lancés à la main avant de pousser.
- **Front :** la logique d'un parcours vit dans une machine d'état pure, testée avec le même runner. Les composants React restent minces : affichage et événements.
- **Tests ZK :** ils exigent la zkey `circuits/build/bari_invoice_final.zkey`, qui n'est pas dans le dépôt. Il faut la copier depuis la machine qui a lancé `zk:setup`. Ne pas relancer `zk:setup` : la vkey changerait et les certificats déjà émis deviendraient invalides.
