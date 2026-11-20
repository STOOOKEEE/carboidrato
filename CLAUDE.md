# Bari · Le fonds de factures dont chaque actif porte sa preuve (IXH26, track 3)

État courant du projet. **Référence produit : [IDEE.md](IDEE.md).** Historique : [docs/DEVLOG.md](docs/DEVLOG.md). L'ancien doc [IXH26-affacturage-solidaire.md](IXH26-affacturage-solidaire.md) (récit hack4good, XLS-96, Noir) est obsolète : n'y chercher que des faits techniques XRPL.

## Stack
- Node 22, TypeScript strict (tsx), `xrpl@5.4.0-beta.0` (version exacte : types Vault/Loan)
- ZK : circom 2.2.2 (compilé dans `circuits/.tools`), snarkjs 0.7.6 (Groth16, BN254), circomlib/circomlibjs
- Front : Vite 8 + React 19 (`web/`), CSS pur ; API Node `node:http` (`src/api`) proxifiée par Vite sur `/api`
- Réseau via `XRPL_WS` (défaut devnet), financement via `XRPL_FAUCET_HOST` ou `XRPL_GENESIS_SEED` (nœud standalone)

## Structure
- Carte des composants (couches, dépendances autorisées, API publiques, conventions TDD) : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), vérifiée par `src/architecture.test.ts`
- `circuits/src/` : circuit `bari_invoice.circom` (IDEE §7.3) + `merkle.circom` ; `circuits/scripts/setup.sh` : setup Groth16 ; `circuits/artifacts/` : wasm + vkey ; `circuits/build/` (gitignoré) : ptau, zkey, r1cs
- `src/zk` : API ZK (attestation EdDSA du débiteur, Merkle, prove, verify, encodage de la preuve pour MPTokenMetadata)
- `src/invoice` : facture, certificat (attestation → preuve → N/P/C → métadonnées), registre N (`Issuer` = PME), MPT facture, vérification de la preuve
- `src/lending` : souscription, prêt (`Data` = N + ID MPT facture + P, contrôles de Bari avant co-signature), remboursement, défaut, rachat
- `src/fund` : modèle du fonds (`Fund`, `Cohort`), fiche du fonds (racine des débiteurs dans le `Data` du Vault), `Data` du LoanSet (`loanData.ts`), lecture des prêts, inspection d'un certificat, concentration par P
- `src/audit` : audit public du fonds depuis le ledger ; `src/demo` : scénario
- `src/setup`, `src/kyb`, `src/accounts`, `src/config`, `src/xrpl`, `src/lib` : mise en place, KYB/KYC, comptes, paramètres, utilitaires
- `src/api` : API du front (`/api/check` pré-contrôle d'une facture attestée `.bari.json`, `/api/kyb`), `contract.ts` = types partagés avec `web/`
- `src/api/fund` : API Fastify du fonds (port 8788) : fonds, dépôts, attestation mairie, entrée du circuit + artefacts pour la preuve dans le navigateur, certificat (409 si N déjà enregistré), prêt, remboursement, défaut, rachat, audit structuré, SSE `/api/events` ; état dans `.bari-state.<réseau>.json` (gitignoré)
- `web/` : landing (héros, simulation drag & drop, « how it works ») + app (`#/app` : KYB, facture, financement à venir) ; `web/src/dither` : moteur de rendu tramé (Bayer 4×4) et formes ; `web/public/samples` : factures d'exemple générées
- `scripts/check-amendments.mjs` ; `infra/alphanet/` : nœud alphanet local sur hermes (bonus, hors démo)

## Commandes
- `npm run demo` (nominal, ~6,5 min sur devnet) ; `npm run demo:default` (défaut + first-loss)
- `npm run audit -- <ID du Vault ou du LoanBroker>`
- Front : `npm run api` + `npm run web` (http://localhost:5173) ; `npm run samples` régénère les 4 factures d'exemple (valide, falsifiée, déjà financée, débiteur inconnu ; enregistre un N sur devnet). Prérequis : comptes de `npm run demo`
- API du fonds : `npm run api:fund` (127.0.0.1:8788, CORS `API_CORS_ORIGIN`, défaut localhost:5173) ; `npm run api:smoke` : test de bout en bout avec preuve côté client (~6,5 min). À fusionner à terme avec `npm run api`
- `npm test` (tous les tests : carte des composants + ZK) ; `npm run typecheck` (back + web) ; `npm run zk:test` ; `npm run web:build`
- ZK : `npm run zk:install-circom` puis `npm run zk:setup`, **une seule fois pour tout le projet (déjà fait)**. Sur une autre machine, copier `circuits/build/bari_invoice_final.zkey` depuis celle du setup : relancer change la vkey et invalide les preuves existantes
- Alphanet : `bash infra/alphanet/build.sh` puis `run.sh` sur hermes ; `bash infra/alphanet/tunnel.sh` sur le Mac, puis `XRPL_WS=ws://127.0.0.1:51233`

## Conventions
- Certificat en un seul `Batch` `tfAllOrNothing` (enregistrement de N → MPT facture → MPTokenAuthorize de Bari → transfert), puis LoanSet à part (pas de Lending en Batch sur devnet). En cas de rejeu, le Batch externe reste `tesSUCCESS` mais aucune transaction interne n'est appliquée : la détection se fait par les hash internes. Ne jamais supprimer un enregistrement N.
- Paramètres IDEE §4 dans `src/config/finance.ts` (90 %, 45 € de frais, 6 %/an, 1 % des intérêts, mise de 10 %, plafond de 20 % par débiteur).
- Seeds dans `.wallets.<réseau>.json` (gitignoré), jamais dans les logs.

## Où on en est
- Fait : circuit + tests (11/11), flow IDEE sur devnet, audit, preuve réelle branchée dans le certificat et dans l'audit ; premier jet du front (UI en anglais, DA dither) : simulation réelle contre devnet + KYB.
- Front, limites : le pré-contrôle tourne côté serveur (le fichier quitte le navigateur, à porter en wasm) ; le KYB n'accepte que la PME de la démo ; le bouton « Request funding » (preuve → certificat → prêt) n'est pas branché.
- À faire (IDEE §9) : brancher le financement dans l'app, script de démo minuté, slides ; option : chiffrement pour l'auditeur (§7.6).
- Alphanet : compilation en cours sur hermes (bonus).
