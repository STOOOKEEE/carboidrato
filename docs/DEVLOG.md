# DEVLOG

## 2026-11-20 · Vérification des amendments (alphanet / devnet)

**Quoi :** script `scripts/check-amendments.mjs`, qui interroge `feature` et compare avec la liste des amendments requis.

**Pourquoi :** l'équipe veut tout faire sur l'alphanet, avec `LendingProtocolV1_2` (LoanSet en Batch, LoanBroker privé).

**Résultats :**
- Devnet (107 features) : MPTokensV1, ConfidentialTransfer, SingleAssetVault, LendingProtocol, LendingProtocolV1_1, Credentials, PermissionedDomains, BatchV1_1, fixBatchV1_2, TokenEscrow sont **activés**. `LendingProtocolV1_2` est **absent** : le serveur ne le connaît même pas.
- Alphanet : **injoignable.**
  - `alphanet.xrpl.org` n'a pas d'enregistrement DNS (ni ws, ni JSON-RPC).
  - `alphanet.nerdnest.xyz` résout vers 64.190.63.111, mais renvoie « connection reset » sur 443 et un timeout sur 51233/51234.
  - Pas d'hôte alphanet dans `~/.ssh/config`. La branche `alphanet` de rippled (e94e578) ne contient aucun hostname ni `[ips]` propre. La recherche web ne donne aucun endpoint public.

**Cheminement :** essayé les 4 URLs du doc de conception, plus des variantes `rippletest.net`, en WebSocket et en JSON-RPC.

**Mise à jour :** l'équipe a fourni `wss://alphanet.nerdnest.xyz` et le faucet `https://alphanet.faucet.nerdnest.xyz/accounts`. Ces deux adresses sont mortes, confirmé par deux vérifications indépendantes : depuis le Mac, le port 80 renvoie `server: Parking/1.0` (domaine parqué) ; depuis hermes (autre réseau), TLS échoue avec `unrecognized name` sur le nœud comme sur le faucet. C'est l'URL de 2025 tirée de l'article de Denis Angell, plus servie aujourd'hui.

**Conséquence :** on code sur devnet en mode « deux étapes » (Batch mint+cession, puis `LoanSet` hors Batch). V1_2 reste un bonus, à condition d'obtenir l'URL de l'alphanet auprès des organisateurs.

## 2026-11-20 · Nœud alphanet local sur hermes

**Quoi :** compilation de la branche `alphanet` (e94e578) dans Docker (`gcc:15`, conan, Rust 1.97.1), puis lancement en standalone avec V1_2 activé dès le genesis. Scripts dans `infra/alphanet/`.

**Pourquoi :** pas d'endpoint alphanet public. Or l'équipe veut V1_2 (LoanSet en Batch, LoanBroker privé).

**Cheminement :**
- Dans le code public, `LendingProtocolV1_2` est `Supported::No`. Le « force_supported » de la CI n'est qu'un `sed` qui passe tous les `Supported::No` en `Yes` (`.github/workflows/reusable-build-test-config.yml`), et on fait la même chose.
- Pas d'image Docker alphanet publiée : l'image `ghcr.io/xrplf/xrpld/supported` est construite depuis `develop`.
- Au genesis (`--start`), rippled active les amendments « désirés ». V1_2 étant `DefaultNo`, il faut le voter dans `[amendments]` (`<sha512half(nom)> <nom>`). `gen-amendments.mjs` génère la liste : amendments actifs sur le devnet ∩ build alphanet, plus V1_2, soit 46 en tout.
- En standalone, les ledgers ne se ferment pas tout seuls : l'entrypoint appelle `ledger_accept` toutes les 3 s.

**Sécurité :** pas de port peer ; WS 51233 et RPC 51234 liés à 127.0.0.1 ; `--network host` sans aucun `-p` (Docker contourne le firewall quand il publie un port). L'accès se fait uniquement par tunnel SSH.

## 2026-11-20 · Cœur XRPL (chantier A) sur devnet, sans Batch

**Quoi :** `npm run demo` (nominal, ~5,5 min, 33 tx en `tesSUCCESS` + `tecDUPLICATE` sur le rejeu) et `npm run demo:default` (impairment, défaut, first-loss).

**Pourquoi :** pas de V1_2 sur devnet, donc pas de Batch. Le credential du registre est créé avant le mint et sert de verrou. La lecture `ledger_entry` faite avant n'est qu'informative.

**Cheminement :**
- Un MPT avec `tfMPTCanHoldConfidentialBalance` est accepté comme actif de Vault : pas besoin de deux tokens.
- EURc à 6 décimales, pour que les intérêts d'une cohorte de 3 min soient visibles.
- L'intervalle du prêt est calculé à partir de l'heure du ledger, ≥ 60 s avant le rachat plus 15 s de marge.
- First-loss : la couverture minimale de 10 % ne protège que 10 % de la dette (−57 % pour les investisseurs dans le scénario défaut). À relever pour la démo.

**Bugs & fix :**
- Le type xrpl.js de `ledger_entry` credential attend `credentialType`, alors que rippled lit `credential_type`. On calcule nous-mêmes l'index (`keylet::credential`).
- L'autofill de `LoanSet` émet un avertissement : Fee fixé à frais du ledger × 2 signatures. `PaymentRemaining` est absent du ledger quand il vaut 0.
- `submitAndWait` attend jusqu'à l'expiration sur un tem* : soumission maison qui s'arrête tout de suite sur tem/tef/tel.

## 2026-11-20 · Circuit Groth16 de Bari (IDEE §7.3, priorité 1)

**Quoi :** `circuits/src/bari_invoice.circom`, avec signature EdDSA-Poseidon du débiteur, Merkle de profondeur 8, montant ≥ seuil (Num2Bits 64) et sorties `C`/`N`/`P`. Setup avec ptau Hermez 2^15 (empreinte blake2b vérifiée), 2 contributions et un beacon. API Node dans `src/zk/`, 11 tests (`npm run zk:test`). 7 748 contraintes, preuve en environ 0,6 s (Node), 730 octets de métadonnées XLS-89.

**Pourquoi :** priorité 1 d'IDEE. Chaque piège de l'annexe C est couvert par une contrainte ou un contrôle du vérificateur.

**Cheminement :**
- circom 2.2.2 est compilé avec cargo dans `circuits/.tools`, car il n'existe pas de binaire macOS arm64.
- `--O2` fait passer de 15 900 à 7 748 contraintes.
- La preuve est encodée en binaire à largeurs fixes puis en base64 (600 caractères, contre plus de 1 200 en JSON).
- `uuid` = les 31 premiers octets de HMAC-SHA256.
- Domaines `bari.nullifier.v1` et `bari.pseudonym.v1`.

**Bugs & fix :**
- URL officielle du ptau en 403 : on passe par un miroir GitHub, et seule l'empreinte sert de garantie.
- Node ne quittait pas à cause des workers BN254 de snarkjs : `releaseZkResources()` est obligatoire en fin de script.
- Relancer `zk:setup` change la vkey, ce qui invalide les preuves déjà produites : le setup se lance une seule fois.

## 2026-11-20 · Flow aligné sur IDEE + vraie preuve branchée

**Quoi :**
- Flow XRPL refondu selon IDEE :
  - PME, mairie débitrice, et Bari qui apporte la first-loss ;
  - paramètres 90 % / 45 € / 6 %/an / 1 % / 10 % ;
  - registre `CredentialCreate(Issuer = PME, Subject = registre, Type = N)` ;
  - prêt avec `Data` = N + ID du MPT facture + P ;
  - racine des débiteurs dans le `Data` du Vault ;
  - plafond de 20 % par P ;
  - `npm run audit`.
- Le certificat utilise maintenant `src/zk` : attestation EdDSA, preuve Groth16 (environ 0,4 à 0,6 s), vérification réelle dans l'audit et avant la co-signature.

**Pourquoi :** IDEE.md devient la référence produit (§9, priorités 1 à 3).

**Cheminement :**
- Les métadonnées du MPT facture ne contiennent plus que la preuve encodée : N, P, C, racine, compte, seuil, échéance, networkId, registre et millésime sont relus dans ses signaux publics, ce qui laisse une seule source de vérité.
- La confrontation au ledger (compte prouvé = emprunteur, racine/millésime/registre du fonds, networkId, N/P du prêt) est faite dans `fund/invoiceInspection.ts`.
- Une preuve invalide bloque le prêt (avant, c'était un simple avertissement).
- Le Loan ne stocke pas `Data` : l'audit relit le LoanSet via `PreviousTxnID`.
- Le MPT facture est rendu à la PME mais pas détruit, pour rester auditable.

**Vérifié :**
- `npm run demo` sur devnet : 387 s, sortie 0, la PME reçoit 8 955 €, rejeu en `tecDUPLICATE`, audit avec 2/2 preuves Groth16 valides, rachat > dépôt.
- `npm run audit` seul sur le fonds : 0 anomalie.
- Preuve lue depuis le ledger puis altérée : N modifié → « Preuve Groth16 invalide » ; autre compte attendu → « Entrée publique inattendue : account ».

**Bugs & fix :**
- `tecNO_PERMISSION` au LoanSet (échéance à moins de 60 s du rachat) : marge de 30 s et phase d'investissement de 240 s.
- Ticker XLS-89 trop long : `BINV`.

## 2026-11-20 · Premier jet du front (landing + simulation + KYB)

**Quoi :**
- `web/` (Vite + React) : landing avec simulation drag & drop, app `#/app` (KYB, facture, financement à venir). DA dither : moteur canvas maison (seuil de Bayer 4×4, ondulation, pointeur, ligne de scan, dissolution entre formes).
- `src/api` : `/api/check` refait les contrôles de Bari sur une facture attestée `.bari.json` (signature EdDSA recalculée, débiteur dans l'arbre de Merkle, networkId + registre, échéance, N absent du registre on-chain) et chiffre l'offre ; `/api/kyb` émet `KYB_PME` via `onboardSme`.
- `npm run samples` : 4 factures d'exemple, dont une « déjà financée » dont le N est réellement enregistré sur devnet.
- `loanTerms` / `theoreticalLoanEconomics` paramétrés (montant, durée) ; `verifyAttestation`, `invoiceNullifier`, `isSmeKybDone`, `loadActors` ajoutés.

**Pourquoi :** IDEE §9 priorité 4 ; il faut que la démo montre le refus d'une facture falsifiée ou déjà financée, en direct.

**Cheminement :**
- Contrôles côté serveur plutôt que dans le navigateur : circomlibjs et le code `src/` dépendent de Node (Buffer, node:crypto) ; à porter en wasm pour tenir la promesse « la facture ne quitte pas le navigateur ».
- Un PDF déposé n'est pas refusé comme faux : il est « non attesté » (il faut la signature du débiteur).
- Libellés des contrôles côté front (l'API renvoie des identifiants), UI en anglais pour le jury.

**Vérifié :** les 4 exemples via l'API (éligible 11 104,20 € pour 12 400 € à 90 jours ; refus signature / unicité / débiteur), JSON illisible et format inconnu → 422, KYB sur la PME démo → OK ; parcours desktop vu dans Chromium headless (landing, valide, falsifiée, app). Typecheck, build, zk:test 11/11.

**Bugs & fix :** points parasites autour des formes : l'ondulation du seuil allumait le fond → ondulation pondérée par la luminance de la cellule. Le glyphe € de la police donnait un « C » une fois tramé → € dessiné à la main.

## 2026-11-20 · Certificat en Batch atomique

**Quoi :** le certificat (CredentialCreate N, MPT facture avec la preuve, MPTokenAuthorize de Bari, Payment PME → Bari) part dans un seul `Batch` `tfAllOrNothing`, soumis par la PME et signé par Bari (`BatchSigners`, `signMultiBatch`). Code dans `src/xrpl/batch.ts` et `src/invoice/issueCertificate.ts`, sans changement de signature.

**Pourquoi :** c'est l'atomicité promise par IDEE §6 : une facture déjà enregistrée ne laisse plus aucun objet derrière elle.

**Cheminement :**
- Les séquences sont fixées à l'avance (Batch externe S, internes S+1… pour la PME, la séquence suivante pour Bari), pour connaître l'ID du MPT (séquence big-endian + AccountID) avant de construire le `MPTokenAuthorize`.
- `client.autofill(batch, 1)` calcule les frais : 2 × la base, plus les transactions internes, plus une base par signataire.

**Bugs & fix :**
- Le Batch externe est validé en `tesSUCCESS` même quand une transaction interne échoue, et le `tecDUPLICATE` n'apparaît nulle part sur le ledger : la transaction interne fautive n'est pas enregistrée.
- Détection : on cherche le hash de chaque transaction interne (toutes présentes ou toutes absentes), puis on vérifie par `ledger_entry` que le MPT n'existe pas. Vérifié sur le devnet : rejeu `FB333316…`, 4 transactions internes en `txnNotFound`, MPT `entryNotFound`, audit 2/2.

## 2026-11-20 · API du fonds (Fastify, port 8788)

**Quoi :** `src/api/fund`, lancé avec `npm run api:fund`.
- Routes : fonds, dépôts, KYB, attestation de la mairie (format `bari.attested-invoice.v1` du front), chemin de Merkle, artefacts du circuit servis en statique, entrée du circuit pour `snarkjs.groth16.fullProve` dans le navigateur, certificat (409 si N déjà enregistré), variante où le serveur calcule la preuve, prêt, remboursement, défaut, rachat, audit structuré.
- SSE `/api/events` : step, info, warn, tx (avec lien explorer), operation.
- État persisté dans `.bari-state.<réseau>.json`.

**Pourquoi :** donner au front (codé par Armand dans `web/`) un backend complet qui réutilise les modules existants.

**Cheminement :**
- Serveur séparé de l'API node:http d'Armand (`src/api/*.ts`, port 8787), pour ne pas se marcher dessus ; fusion à faire plus tard.
- Transactions capturées par un abonnement au logger (`onLogEvent`) plutôt qu'en modifiant chaque module.
- File d'opérations pour éviter les conflits de séquence.
- Chantiers parallèles isolés par des fichiers de wallets distincts (`XRPL_WALLETS_FILE`).

**Vérifié :**
- `npm run api:smoke` (preuve calculée côté client) : 387 s, rejeu en 409, audit 1/1, 98 événements SSE.
- Contrôle manuel : écoute sur 127.0.0.1 uniquement, CORS refusé pour une origine étrangère, aucune seed renvoyée, validation des corps de requête.
- Non lancé sur le ledger : `POST /api/loans/:id/default`.

**Bugs & fix :**
- Le 409 reposait sur `tecDUPLICATE`, que le Batch ne produit plus : il pointe maintenant sur le Batch refusé.
- `NextPaymentDueDate` disparaît une fois le prêt soldé, ce qui faisait planter la vue du fonds.

## 2026-11-20 · Carte des composants et baseline de tests

**Quoi :**
- `docs/ARCHITECTURE.md` : couches, dépendances autorisées, API publique de chaque composant, port `Ledger` de départ, conventions TDD.
- `src/architecture.test.ts` fait échouer `npm test` dès qu'un composant importe une couche supérieure, ou que le front importe autre chose que `src/api/contract.ts`.
- Nouveau script `npm test` : tous les `src/**/*.test.ts`.

**Pourquoi :** passer au TDD par composants sans réécrire le dépôt.

**Cheminement :** le graphe des imports contenait trois cycles :
- `fund ↔ lending` (le `Data` du LoanSet) ;
- `lending ↔ setup` (le type `Fund`) ;
- `kyb → setup → lending → kyb` (les credentials KYC).

Ils sont cassés par trois déplacements sans changement de comportement : `Fund` et `Cohort` vers `fund/fund.ts`, `loanData.ts` vers `fund/`, `kycCredentials.ts` vers `kyb/`.

**Vérifié :**
- Le test d'architecture était rouge avant les déplacements (9 imports en violation), il est vert après.
- Typecheck back + web et `web:build` passent.
- `npm test` : 7 tests sur 14 passent. Les 7 échecs sont des tests ZK qui exigent `circuits/build/bari_invoice_final.zkey`, absente d'un clone neuf.

## 2026-11-20 · Nœud alphanet local opérationnel (V1_2 actif)

**Quoi :** compilation terminée à 20h10 (3h08 en tout, dont environ 1h40 de dépendances conan). Nœud standalone lancé dans Docker sur hermes, accessible par `infra/alphanet/tunnel.sh`. `check-amendments` via le tunnel : tous les requis activés, **`LendingProtocolV1_2` activé**. `network_id` 2026.

**Sécurité vérifiée :**
- `ss` : seuls 127.0.0.1:51233 et 127.0.0.1:51234 écoutent ; aucun port peer ; aucun port Docker publié (`--network host`).
- Requête vers l'IP Tailscale de hermes depuis hermes et depuis le Mac : refusée.

**Bugs & fix :**
- Compilation lente : aucun binaire conan précompilé pour gcc 15, donc les 23 dépendances ont été recompilées, sur une VM partagée de 6 cœurs dont le build n'obtient qu'environ 3.
- `network_id` absent : la démo refuse de prouver sans networkId, d'où `[network_id] 2026`.
- Logs en DEBUG sur stdout et `ledger_accept` bavard : `[rpc_startup] log_level warning`, sortie de la CLI redirigée, logs Docker plafonnés (20 Mo × 3).
- Le watcher du build n'a pas signalé la fin : vérifier `BUILD_EXIT` dans `build.log`.

## 2026-11-20 · Alphanet ouvert aux coéquipiers, sans accès à hermes

**Quoi :**
- Troisième port WebSocket **sans admin** (127.0.0.1:51236), exposé par un quick tunnel Cloudflare (`infra/alphanet/public-tunnel.sh`, conteneur `xrpl-alphanet-public`, connexion sortante uniquement).
- Les coéquipiers soumettent des transactions signées par l'URL `wss://….trycloudflare.com`, sans SSH ni accès réseau à hermes.

**Vérifié depuis le Mac, uniquement par l'URL publique :**
- `check-amendments` : tous actifs, V1_2 compris.
- `Payment` depuis le compte genesis : `tesSUCCESS`.
- `ledger_accept`, `stop`, `peers` et `validation_create` sont refusés (« Bad credentials »).
- Ports sur hermes : 51233, 51234 et 51236, tous sur 127.0.0.1.

**Bugs & fix :**
- `telREQUIRES_NETWORK_ID` avec `network_id` 2026 : au-delà de 1024, chaque transaction doit porter `NetworkID`, et xrpl.js ne l'ajoute que pour un serveur ≥ 1.11. Notre build se présente en `0.0.0-dev`, donc `network_id` passe à **1000**.
- Redémarrage en boucle avec `--load` (« The specified ledger could not be loaded »). Arrêt propre (`docker stop`) ajouté, sans effet : en standalone, ce build n'écrit aucun ledger en base (table `Ledgers` vide, NuDB à 4 Ko). Cause non identifiée (hypothèse). Décision : genesis neuf à chaque démarrage, documenté dans `run.sh` et `node-entrypoint.sh`.
- L'URL du quick tunnel change à chaque relance du conteneur `xrpl-alphanet-public`.

## 2026-11-20 · Module BN254 corrigé et seuil prouvé dérivé de l'avance

**Quoi :**
- `src/zk/field.ts` : `BN254_FIELD_MODULUS` vaut l'ordre du sous-groupe (`2188…5617`), le corps scalaire de circom et snarkjs. L'ancienne valeur n'était ni `r` ni `q`, et laissait passer des valeurs hors du corps.
- `src/lending/loanTerms.ts` : `provenThresholdCents(principal)`, le plus petit seuil tel que `principal ≤ 90 % × seuil`, exposé dans `LoanTerms`. L'API (`zkInputs.ts`, `certificateFromProof.ts`) et le scénario CLI l'utilisent à la place de `PROVEN_THRESHOLD_CENTS` et de `thresholdEur`.
- Outillage e2e : `@playwright/test`, `playwright.config.ts` (API du fonds sur 8788, puis Vite), `npm run e2e`.

**Pourquoi :** une avance de 9 000 € se prouve au seuil de 10 000 € ; le montant exact de la facture (10 340 € dans la démo) ne sort jamais du témoin.

**Vérifié :** tests écrits d'abord et rouges (`field.test.ts`, `loanTerms.test.ts`), puis `npm test` 20/20, typecheck et `web:build` verts.

## 2026-11-21 · Témoin dans le navigateur, machine du financement, composants partagés

**Quoi :**
- `GET /api/debtors` publie la clé publique de chaque débiteur vérifié, dans l'ordre des feuilles (`PublicDebtor` dans `contract.ts`).
- `web/src/features/funding/witness.ts` : arbre de Merkle (`poseidon-lite`) et entrée du circuit, calculés dans le navigateur. `npm run fixtures` (`src/demo/fixtures.ts`) écrit le fixture de parité depuis `src/`.
- `web/src/features/funding/funding.machine.ts` : machine d'état pure du financement (preuve, certificat, prêt, refus, doublon, erreur avec reprise).
- `web/src/ui/` : `Button` (`data-primary`, raison obligatoire si désactivé), `StepCard`, `Stepper`, `TxLink`, `Details`, `Notice`. Le canvas de trame lit ses couleurs dans les variables CSS.

**Pourquoi :** le témoin (montant, uuid, signature, chemin, aléa `r`) ne doit jamais quitter le navigateur de la PME.

**Vérifié :** test de parité rouge puis vert (racine, chemins des 3 débiteurs, entrée du circuit identique au back) ; `npm test` 52/52 (dont `web/src/**/*.test.ts`), typecheck et `web:build` verts.

## 2026-11-21 · Pré-contrôle et preuve dans le navigateur, port `Ledger`, détail de transaction

**Quoi :**
- `web/src/features/funding/` : `precheck.ts` (signature, débiteur vérifié, réseau et registre, seuil, échéance, unicité de `N`), `prover.ts` (`snarkjs.groth16.fullProve` avec le wasm et la zkey de l'API, `r` tiré par `crypto.getRandomValues` ; la signature se contrôle par le seul calcul du témoin), `sources.ts` (branchement sur l'API, snarkjs chargé à la demande).
- Une seule API : le serveur `node:http` (8787, `/api/check`, `/api/kyb`) est supprimé, le proxy Vite pointe sur 8788, `npm run api` devient un alias de `api:fund`. Nouvelles lectures publiques : `GET /api/proof/params`, `GET /api/registry/:nullifier?account=`, `GET /api/sme/kyb/:account`, `GET /api/offer?dueDate=`. `POST /api/sme/kyb` prend le formulaire KYB.
- Offre du fonds : avance fixe de 9 000 € adossée au seuil prouvé de 10 000 € (`fundOffer`), le montant exact n'y entre plus.
- Port `Ledger` (`src/xrpl/ledger.ts`, faux en mémoire `fakeLedger.ts`) : `verifyBeforeCosigning` refuse un `N` déjà référencé par un prêt de n'importe quel LoanBroker de Bari.
- `GET /api/tx/:hash` et écran `#/tx/<hash>` : type, résultat, comptes, objets créés, transactions internes d'un `Batch`, certificat décodé des métadonnées du MPT facture. Lien explorer seulement là où il en existe un (devnet).

**Pourquoi :** le serveur de Bari ne reçoit plus que `{ proof, publicSignals }` ; l'AlphaNet n'a pas d'explorer.

**Vérifié :** tests rouges puis verts (`precheck`, `prover`, `offer`, `loanChecks`, `txRoutes`, `txView`) ; `npm test` 80/80 ; e2e `web/e2e/prove.spec.ts` sur l'AlphaNet : 2/2 (pré-contrôle de la landing sans `/api/check`, preuve calculée dans la page, corps du certificat limité à `proof` et `publicSignals`, aucune valeur privée dans les requêtes).

## 2026-11-21 · Fonds de démo durable (`npm run demo:fund`)

**Quoi :**
- `src/demo/fund.ts` : si `.bari-state.<réseau>.json` tient un fonds alimenté en phase d'investissement avec au moins 30 min avant le rachat (`isReusable`, `fundReuse.ts`), il est réutilisé sans transaction ; sinon un fonds est créé (`COHORT_INVESTMENT_S=21600` par défaut), avec dépôts, first-loss et deux prêts sur la Comune di Lecce (même `P`, 18 % de concentration), puis l'état est écrit par `FundStateStore`, lu tel quel par l'API. La facture en direct de la Comune di Bari (9 %) reste ainsi sous la limite de 20 %.
- `src/demo/financing.ts` : ouverture du fonds et financement d'une facture, partagés par `demo` et `demo:fund`.
- Playwright : l'API e2e démarre par `npm run demo:fund && npm run api:fund`. Pas de `globalSetup` : Playwright lance les `webServer` avant lui, et l'API ne lit l'état qu'à son démarrage.

**Pourquoi :** le front et l'e2e trouvent toujours un fonds avec un historique, sans le recréer à chaque lancement.

**Vérifié :** `fundReuse.test.ts` rouge puis vert ; AlphaNet : premier `demo:fund` en 108 s (sortie 0), second en 1 s (réutilisation, aucune transaction) ; `GET /api/fund` en phase `investment` avec 2 prêts actifs ; `npm run e2e` 2/2 ; `npm test` 99/99, typecheck vert.

## 2026-11-21 · Une seule API, certificat sur preuve seule

**Quoi :**
- Routes `POST /api/sme/circuit-input` et `POST /api/sme/certificate/server-proof` supprimées : l'API ne construit plus l'entrée du circuit et ne calcule plus de preuve.
- `buildApp` : Ajv sans `removeAdditional`. Un champ inattendu (ex. `amount` ou `blinding` à côté de la preuve) est refusé en 400 au lieu d'être retiré en silence.
- `npm run api:smoke` construit l'entrée du circuit lui-même (`buildProveInput`, `toCircuitInput`) à partir de `GET /api/proof/params` et de la fiche du fonds, comme le navigateur.
- `src/api/fund/app.test.ts` : routes testées par `app.inject()` sur un faux contexte (faux `Ledger`, store temporaire), sans réseau.

**Pourquoi :** le témoin ne doit jamais atteindre le serveur, même par un champ en trop.

**Vérifié :** `app.test.ts` rouge puis vert (13 cas) ; `npm test` 93/93 ; AlphaNet : `npm run api:smoke` réussi en 346 s (preuve côté client en 0,7 s, rejeu refusé en 409, prêt, remboursement, rachat) sur un état séparé (`BARI_STATE_FILE`).

## 2026-11-21 · Comptes, sessions et espace organisme public (API)

**Quoi :**
- `src/accounts/userStore.ts` : comptes email + mot de passe (haché `scrypt`, sel par utilisateur, `timingSafeEqual`), un rôle par compte (`lender`, `business`, `public_body`), email et n° de TVA normalisés et uniques, un seul compte par organisme public. Fichier `.bari-state.<réseau>.users.json` (gitignoré, mode 600), avec le secret de session et les seeds des comptes gérés.
- `src/api/fund/auth.ts` : cookie `bari_session` signé HMAC, `httpOnly`, `SameSite=Lax`, 7 jours ; garde `requireRole` (401 sans session, 403 pour un autre rôle).
- Routes `POST /api/auth/signup|signin|signout`, `GET /api/me`. L'inscription ouvre le compte XRPL géré par le port `ProvisionAccount` (`src/accounts/provisioning.ts` : compte créé et financé ; les credentials suivent).
- `GET /api/public-body/keys` : les clés d'attestation de l'organisme de la session, et seulement les siennes. `GET /api/businesses/by-vat/:vat` : raison sociale et compte d'un fournisseur inscrit.
- `POST /api/debtor/attest` supprimée : la facture sera signée dans le navigateur de l'organisme. `api:smoke` et l'e2e `prove.spec.ts` signent localement (`web/e2e/signedInvoice.ts`).

**Pourquoi :** trois espaces avec de vrais comptes ; le serveur de Bari ne voit plus jamais une facture, même pour la signer.

**Vérifié :** `userStore.test.ts`, `authRoutes.test.ts`, `publicBodyRoutes.test.ts` rouges puis verts (sans réseau, `fakeContext.ts`) ; `npm test` 127/127 ; e2e `prove.spec.ts` 2/2 sur l'AlphaNet.

## 2026-11-21 · Fonds ouvert jusqu'au pitch

**Quoi :**
- `npm run demo:fund` crée un Vault fermé dont le rachat tombe le 2027-03-31 (accepté par le ledger), réutilisé tant que le rachat est à plus de 24 h.
- Bari dépose un stock de parts de 20 000 EURc pendant la souscription et garde une réserve de 20 000 EURc (`BARI_SHARE_STOCK_EUR`, `BARI_EURC_RESERVE_EUR`) : de quoi servir l'entrée et la sortie immédiates des prêteurs pendant la période de prêt.
- Deux prêts d'historique à 90 jours sur la Comune di Lecce, dont un remboursé.
- Échéance d'un prêt = échéance prouvée de la facture, bornée par le rachat moins la marge du ledger (`loanPaymentInterval`, `loanTerms.ts`).

**Pourquoi :** le fonds doit rester en phase de prêt jusqu'au pitch, et un prêt ne doit pas durer plus que la facture qu'il finance.

**Vérifié :** `fundReuse.test.ts` et `loanTerms.test.ts` rouges puis verts ; AlphaNet : fonds créé en 120 s (Vault `01B19D79…99D0`), second lancement sans transaction ; `GET /api/fund` → `phase: "investment"`, rachat au 2027-03-31, un prêt remboursé et un en cours ; 20 000 parts et 20 091 EURc sur le compte de Bari.

À savoir : sur ce fonds, la mise en défaut d'un prêt attendrait son échéance (~90 jours) ; le scénario `npm run demo` (cohorte courte) n'est pas touché.

## 2026-11-21 · Comptes gérés vérifiés sur le ledger à l'inscription

**Quoi :**
- `src/kyb/onboarding.ts` (remplace `src/accounts/provisioning.ts`) : à l'inscription, Bari crée et finance le compte XRPL de l'utilisateur, émet le credential `KYC_INVESTOR` (prêteur) ou `KYB_PME` (entreprise) pour un an, avec le haché du dossier déclaré en `URI`, le fait accepter par le compte, puis autorise l'EURc (et les parts du Vault pour un prêteur). Un organisme public n'a pas de compte XRPL. Sans fonds ouvert, l'inscription est refusée avant toute transaction.
- Port `SubmitTx` (`src/xrpl/submit.ts`) : la même logique tourne sur le nœud ou sur un faux qui enregistre les transactions.
- `GET /api/public-bodies` : le registre des organismes vérifiés, sans clé, avec ceux qui n'ont pas encore de compte.
- `POST /api/sme/kyb` supprimée (réservée à la PME de démo) : le KYB se fait à l'inscription.

**Pourquoi :** chaque utilisateur a un vrai compte vérifié sur le ledger : le vault privé n'accepte que les porteurs de `KYC_INVESTOR`, et Bari ne prête qu'aux porteurs de `KYB_PME`.

**Vérifié :** `onboarding.test.ts` (transactions attendues par rôle) et `publicBodyRoutes.test.ts` rouges puis verts ; `npm test` 131/131 ; AlphaNet : inscription d'un prêteur (5 transactions) et d'une entreprise (4 transactions), toutes `tesSUCCESS` ; `account_objects` : credentials acceptés, expiration au 2027-11-21, MPToken EURc et parts.

## 2026-11-21 · Espaces prêteur et entreprise (API)

**Quoi :**
- Prêteur (`src/fund/sharePrice.ts`, `src/lending/lenderTrades.ts`, `routes/lenderRoutes.ts`) : prix de la part = (`AssetsTotal` − `LossUnrealized`) / parts en circulation, rendement variable des prêts en cours, prix de revient suivi par prêteur. `GET /api/lender/position`, `POST /api/lender/faucet` (10 000 EURc de test), `POST /api/lender/deposit|withdraw` : `VaultDeposit`/`VaultWithdraw` natifs pendant la souscription et le rachat ; pendant la période de prêt, un `Batch` atomique de deux `Payment` (parts ↔ EURc) signé par Bari et par le compte géré du prêteur, sortie à −0,5 %, dans la limite du stock de parts et de la réserve de Bari. `POST /api/investors/deposit|redeem` supprimées.
- Entreprise (`loanTerms.ts`, `loanChecks.ts`, `routes/smeRoutes.ts`) : paliers publics 5 000 à 100 000 € ; avance = 90 % du palier prouvé, frais 0,5 %. Certificat et prêt agissent pour le compte géré de la session. Les contrôles de Bari (KYB, preuve, avance, unicité, concentration, échéance) reviennent un par un avec leur raison, en 422 au premier échec. `GET /api/business/invoices` : factures du compte. Port `Ledger` : `closeTime()`.

**Pourquoi :** les prêteurs entrent et sortent à tout moment malgré le vault fermé, et une entreprise ne peut financer que ses propres factures, avec un refus qui dit pourquoi.

**Vérifié :** tests rouges puis verts ; `npm test` 190/190. AlphaNet, fonds durable : un prêteur inscrit reçoit 10 000 EURc de test, entre pour 5 000 EURc (`Batch` `tesSUCCESS`, 4 994,51 parts au prix de 1,001098), puis sort de 2 000 parts (`Batch` `tesSUCCESS`, 1 992,18 EURc reçus) ; au-delà de son solde → 422 ; session entreprise → 403 ; sans session → 401.

## 2026-11-21 · Trois espaces à comptes dans le front, preuve au palier de la facture

**Quoi :**
- Front : routes `#/`, `#/signin`, `#/signup/<rôle>`, `#/lend`, `#/public`, `#/business`, `#/transparency`, `#/tx/<hash>` (`web/src/routes.ts`), garde des espaces (sans session → connexion, autre rôle → explication), session lue de `GET /api/me`. Inscription par rôle avec le KYC léger (`features/account/account.machine.ts`, pur et testé), puis « Verifying… » : une ligne par transaction d'ouverture du compte, avec son lien. Navigation et menu du compte (rôle, « Verification: basic (self-declared) », déconnexion).
- Landing : les trois portes (« Start lending », « Confirm an invoice », « Get paid now »), le lien Transparency et 3 chiffres du fonds lus en direct. La simulation de facture et l'ancien `#/app` disparaissent.
- Le navigateur choisit le palier prouvé : le plus grand palier public ≤ montant de la facture (`provenThreshold`, `witness.ts`) ; `GET /api/proof/params` publie les cinq paliers au lieu d'un seuil fixe.
- `npm run api:smoke` suit le parcours à comptes : inscription d'une entreprise, attestation pour son compte, preuve au palier (23 450 € → 20 000 €), certificat et prêt avec le cookie de session, rejeu refusé.
- `POST /api/loans/:id/repay` rembourse avec le compte géré de l'emprunteur enregistré (`UserStore.findBusinessByAccount`) ; port `Ledger.loan`.

**Pourquoi :** chaque acteur a sa porte et son espace, et une facture de 23 450 € n'est plus avancée comme une facture de 10 000 € : seul le palier devient public.

**Vérifié :** tests rouges puis verts ; `npm test` 229/229 ; AlphaNet : `account.spec.ts` 3/3 (prêteur et entreprise inscrits, déconnexion, reconnexion, garde), `prove.spec.ts` 2/2 ; `api:smoke` réussi (preuve au palier de 20 000 € en 705 ms, prêt de 18 000 €, rejeu → 409, `LoanPay` signé par le compte de l'entreprise).

À savoir : Chrome renvoie une `Promise` de `window.scrollTo` ; un effet React qui la renvoie casse la page (« destroy is not a function »).

## 2026-11-21 · Espaces prêteur, organisme public et entreprise dans le front

**Quoi :**
- Prêteur `#/lend` (`features/lend/`) : position (valeur, parts, gain, rendement variable), carte du fonds, « Add test euros », « Deposit » et « Withdraw » avec l'aperçu (voie native ou immédiate, frais de sortie, plafond du stock et de la réserve de Bari), historique des mouvements avec liens `#/tx/<hash>`. Montants convertis en unités par `bigint` (`lend.machine.ts`).
- Organisme public `#/public` (`features/public-body/`) : FatturaPA lue dans la page par un petit lecteur XML pur (`xml.ts`, `fatturaPA.ts`), fournisseur retrouvé par sa TVA, attestation signée dans le navigateur (`attest.ts` : EdDSA-Poseidon avec `poseidon-lite` et `@noble/hashes`, uuid HMAC par WebCrypto), téléchargement du `.bari.json`. Parité avec `src/zk` testée sur un fixture signé par le back avec des clés de test (`npm run fixtures`). `npm run samples` écrit les FatturaPA FT-2026-0815, -0816 et -0817 ; les anciens exemples `.bari.json` disparaissent.
- Entreprise `#/business` (`features/business/`) : dépôt du fichier signé, contrôles dans le navigateur, offre au palier prouvé, « Get paid now » qui enchaîne preuve, certificat, contrôles de Bari et prêt, chaque étape en direct avec son lien ; « Already financed » avec le lien de l'enregistrement ; « My invoices ». Machine de page pure autour de la machine de financement.
- `npm run demo:fund` remet la mairie à 30 000 EURc à chaque lancement : le remboursement d'un prêt e2e passe par un paiement de la mairie.
- Partagés : `ui/DropZone.tsx`, `e2e/capture.ts` (captures desktop et mobile si `CAPTURE_DIR`).

**Pourquoi :** les trois acteurs du parcours agissent depuis leur propre espace, et la facture ne quitte jamais le navigateur de l'organisme ni celui du fournisseur.

**Vérifié :** tests rouges puis verts ; `npm test` 344/344 ; AlphaNet : `lend.spec.ts` (10 000 EURc de test, dépôt de 5 000, sortie immédiate), `public-body.spec.ts` (aucune requête ne porte le montant ni le numéro), `business.spec.ts` (8 955 € reçus, preuve décodée au lien du certificat, « Already financed », prêt remboursé), `prove.spec.ts`, `account.spec.ts`.

## 2026-11-21 · Page Transparency et comptes du pitch

**Quoi :**
- Transparency `#/transparency` (`features/transparency/`) : la page lit `GET /api/audit`, la vkey et le fonds, contrôle que chaque preuve correspond à son prêt (`N` et `P` du `LoanSet`) et au fonds (racine des débiteurs, millésime), puis la vérifie avec `snarkjs.groth16.verify` dans le navigateur. Chiffres : preuves vérifiées k/k, débiteurs distincts, plus grande exposition, prix de la part, part prêtée ; tableau des prêts avec liens `#/tx/<hash>` ; barres d'exposition par pseudonyme `P` (pleines à la limite de 20 %) ; « Re-verify in my browser ». Agrégation pure et testée (`transparency.ts`).
- `GET /api/audit` renvoie un `FundAudit` (`src/api/contract.ts`) : par prêt, statut, principal, échéance, `N`/`P` et le certificat (preuve et signaux publics) ; plus le prix de la part et le plafond de concentration. `auditKnownFund` passe par le port `Ledger` (route testée avec `app.inject`). `PROOF_PUBLIC_SIGNALS` donne au front l'ordre des signaux publics, testé contre `src/zk/statement.ts`.
- `npm run demo:fund` crée aussi, s'ils manquent, les trois comptes du pitch (prêteur, Asfalti Sparano S.r.l. à la TVA des FatturaPA d'exemple, Comune di Bari) par le même chemin que l'inscription, et vérifie que FT-2026-0815, -0816 et -0817 ne sont pas enregistrées (sortie en erreur sinon).

**Pourquoi :** n'importe quel visiteur re-vérifie chaque preuve du fonds sans faire confiance au serveur de Bari, et le pitch démarre sur des comptes prêts et des factures jamais financées.

**Vérifié :** tests rouges puis verts ; `npm test` 370/370 ; AlphaNet : `transparency.spec.ts` (« 7/7 proofs verified in your browser », puis une seconde vérification), `demo:fund` relancé deux fois (comptes réutilisés, factures non enregistrées), connexion des trois comptes → 200.

À savoir : `demo:fund` écrit le fichier des utilisateurs ; le lancer avant l'API, comme le fait la config Playwright.

## 2026-11-21 · Parcours complet en e2e, tous les boutons, README

**Quoi :**
- `web/e2e/walkthrough.spec.ts` : le parcours du pitch en un test, une étape par moment (landing, prêteur inscrit qui dépose 5 000 EURc, entreprise inscrite, organisme qui signe une FatturaPA dans la page, offre 9 000 €, 8 955 € reçus, preuve décodée au lien du certificat, « Already financed », Transparency k/k, retrait immédiat). Comptes, TVA et numéro de facture uniques, Regione Puglia comme débiteur, prêt remboursé à la fin.
- `web/e2e/buttons.spec.ts` : chaque écran déclare ses boutons et liens attendus avec leur effet (navigation, réponse 2xx, téléchargement, ouverture d'un détail) ; un contrôle visible absent de la liste fait échouer le test. Sur chaque écran : aucun texte « demo », aucun bouton désactivé sans raison affichée.
- `ui/DropZone.tsx` : pendant le traitement, le bouton désactivé porte sa raison (« Working… ») en titre, comme `Button`.
- `README.md` : pitch, parcours, ce que garantit la preuve, fonctionnalités XRPL avec leurs fichiers, lancement local, limites connues, déclaration IA.

**Pourquoi :** le parcours du pitch et chaque bouton de l'interface sont rejoués sur le réseau avant la démo ; le README explique le projet au jury.

**Vérifié :** AlphaNet : `walkthrough.spec.ts` 1/1 (1,3 min), `buttons.spec.ts` 7/7 (1,9 min), puis la suite e2e complète ; `npm test`, typecheck et build verts.

## 2026-11-21 · Favicon

**Quoi :** `web/public/icon.svg`, la grille 3×3 du logo (centre en bleu d'accent) sur fond noir, liée dans `web/index.html` avec un `theme-color` noir.

**Pourquoi :** l'onglet du navigateur montrait l'icône par défaut ; la marque reste lisible en 16 px.

**Vérifié :** rendu en 16, 32 et 64 px ; `npm run web:build` copie `icon.svg` dans `web/dist` ; suite e2e complète sur l'AlphaNet (16/16).

## 2026-11-21 · RLUSD à ligne de confiance, tout en dollars

**Quoi :**
- Le stablecoin du fonds devient le RLUSD, un jeton à ligne de confiance (`src/xrpl/stablecoin.ts`) : émetteur de test de Bari sur l'AlphaNet (`asfDefaultRipple`), celui de Ripple sur le mainnet ; Vault, LoanBroker, prêts, entrée et sortie immédiates en RLUSD. Les parts du Vault et le MPT facture restent des MPT.
- Factures, paliers (5 000 à 100 000 $), offres, frais et économie en dollars ; avance et prêt en RLUSD à 1:1, sans change. Le lecteur FatturaPA n'accepte que `<Divisa>USD</Divisa>` et explique le refus pour toute autre devise ; les FatturaPA d'exemple sont régénérées en USD.
- `npm run demo:fund` recrée le fonds en RLUSD ; un compte du pitch ouvert pour un fonds précédent reçoit la ligne de confiance et l'autorisation des parts du nouveau Vault qui lui manquent (`missingHoldings`, `src/kyb/onboarding.ts`).

**Pourquoi :** décision de Noé : le RLUSD est le stablecoin dollar natif du XRPL, et une seule devise évite tout change entre la facture et le prêt. Le circuit compte en centimes, sans devise : aucun changement ZK.

**Vérifié :** tests rouges puis verts ; `npm test` 432/432 ; AlphaNet : `demo:fund` crée le fonds (105 s, Vault en RLUSD, rachat au 2027-03-31), complète les comptes du pitch, puis relancé le réutilise sans transaction ; `GET /api/fund` → `phase: "investment"`, actif RLUSD.

## 2026-11-21 · Connexion par le wallet Otsu

**Quoi :**
- `POST /api/auth/wallet/challenge` (nonce de 5 min, usage unique ; compte activé par Bari s'il n'existe pas), `POST /api/auth/wallet/verify` (un `AccountSet` jamais soumis, signé par la clé maîtresse du compte, nonce en `Memo`), `POST /api/auth/wallet/register` (rôle prêteur ou entreprise et KYC léger à la première connexion). Utilisateur `custody: "wallet"` : ni mot de passe ni seed côté Bari.
- Front : `web/src/wallet/otsu.ts` (`window.xrpl` d'Otsu), contrôle du réseau du wallet, « Connect Otsu wallet » en action principale de la connexion, l'email en secours.
- E2E : `web/e2e/fixtures/otsuMock.ts` remplace l'extension et signe comme elle avec `@xrpl-commons/xrpl`.

**Pourquoi :** décision de Noé : un vrai parcours non-custodial, où l'utilisateur signe lui-même les transactions de son compte. Xaman ne signe pas sur un réseau privé ; Otsu accepte un réseau perso.

**Vérifié :** tests rouges puis verts (signature invalide, nonce rejoué ou expiré, autre adresse, clé non maîtresse → 401) ; `npm test` 432/432 ; AlphaNet : `wallet-signin.spec.ts` 4/4.

## 2026-11-21 · Ouverture du compte signée dans Otsu

**Quoi :**
- `POST /api/onboarding/prepare` : pour un utilisateur connecté par wallet, Bari émet le credential `KYC_INVESTOR` ou `KYB_PME` (un an) s'il manque, puis prépare ce que le compte de l'utilisateur doit signer lui-même : `CredentialAccept`, ligne de confiance RLUSD et, pour un prêteur, `MPTokenAuthorize` des parts du Vault. Une seule transaction est envoyée seule ; à partir de deux, un `Batch` tfAllOrNothing du seul compte de l'utilisateur.
- `POST /api/onboarding/submit` : le blob signé doit être, octet pour octet, la transaction préparée (hors signature) ; Bari le soumet et vérifie chaque transaction interne.
- Pièces réutilisables pour les dépôts, retraits, certificats et prêts signés dans le wallet : `src/xrpl/preparedTx.ts` (comparaison, transaction en attente par utilisateur, ports du nœud) et `web/src/wallet/sign.ts`.

**Pourquoi :** Bari ne garde aucune seed pour un utilisateur wallet ; il prépare, l'utilisateur signe, Bari vérifie qu'on lui renvoie bien ce qu'il a préparé avant de soumettre.

**Vérifié :** tests rouges puis verts (forme de la transaction par rôle, blob modifié → 400, compte géré → 409, sans session → 401, organisme public → 403) ; `npm test` 470/470 ; AlphaNet : `wallet-signin.spec.ts` 4/4, Batch signé par l'utilisateur en tesSUCCESS, credential accepté et ligne RLUSD lus sur le ledger.

## 2026-11-21 · Prêteurs et entreprises non-custodiaux

**Quoi :**
- Prêteur connecté par Otsu : dépôt et retrait préparés par Bari avec les mêmes contrôles et devis, signés dans le wallet, soumis par `POST /api/lender/submit`. En période de prêt, un `Batch` tfAllOrNothing de deux comptes (RLUSD de l'utilisateur ↔ parts de Bari) : Bari signe ses `BatchSigners` d'abord, l'utilisateur signe le Batch en dernier.
- Entreprise connectée par Otsu : le certificat est un `Batch` dont elle est le compte externe (registre `N`, MPT facture, paiement du MPT à Bari), avec le `MPTokenAuthorize` de Bari en `BatchSigners` ; le `LoanSet` est signé dans le wallet sans soumission, puis Bari refait ses contrôles, le contre-signe (`signLoanSetByCounterparty`) et le soumet. Le remboursement d'un emprunteur wallet est aussi un `LoanPay` signé dans le wallet.
- Les comptes email restent gérés par Bari, sans changement.

**Pourquoi :** l'utilisateur signe chaque transaction de son compte ; Bari n'ajoute que ses propres signatures.

**Vérifié :** tests rouges puis verts (Batch co-signé par Bari, blob modifié → 400, rien de préparé → 409, parcours géré inchangé, 403 pour les autres rôles) ; `npm test` 532/532 ; `prepareTransaction` de la bibliothèque d'Otsu laisse un Batch co-signé et un `LoanSet` identiques octet pour octet ; AlphaNet : `lend.spec.ts` 2/2 et `business.spec.ts` 2/2 avec le faux Otsu (dépôt et retrait en tesSUCCESS, 8 955 RLUSD reçus, « Already financed », prêt remboursé).

## 2026-11-21 · Parcours du pitch signé dans Otsu

**Quoi :**
- `walkthrough.spec.ts` déroule les 9 étapes du pitch avec le prêteur et l'entreprise connectés par le faux Otsu (ouverture du compte, dépôt de 5 000 RLUSD, certificat et prêt, retrait, tous signés dans le wallet) ; l'organisme public reste en email. Les vérifications sur le ledger communes aux e2e Otsu sont dans `web/e2e/fixtures/otsuLedger.ts`.
- Correctif : un organisme public ne retrouvait pas par sa TVA une entreprise connectée par wallet (la recherche lisait le seul compte géré). Un seul helper, `userAddress`, donne désormais le compte XRPL d'un utilisateur, géré ou wallet.
- `PITCH_BUSINESS=otsu npm run demo:fund` libère la TVA du fournisseur du pitch (compte email supprimé s'il n'a pas de prêt en cours, pas recréé) pour l'ouvrir avec Otsu ; ensuite `demo:fund` reconnaît ce wallet comme le compte du pitch.
- README : tout en dollars et RLUSD, « Connect Otsu », tableau « qui signe quoi », limites (Xaman et GemWallet ne signent pas sur un réseau privé, comptes email gérés par Bari).

**Pourquoi :** le pitch se fait avec Otsu ; la facture FT-2026-0815 porte la TVA du fournisseur du pitch, qui ne peut appartenir qu'à un compte.

**Vérifié :** tests rouges puis verts (recherche par TVA d'une entreprise wallet ; fournisseur du pitch tenu par un wallet, compte email libéré, refus avec un prêt en cours) ; `npm test` 537/537 ; AlphaNet : `walkthrough.spec.ts`, `lend.spec.ts` et `business.spec.ts` verts ; `demo:fund` avec et sans `PITCH_BUSINESS=otsu` sur une copie de l'état.
