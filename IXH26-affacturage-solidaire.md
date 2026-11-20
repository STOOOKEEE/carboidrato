# IXH26 · Affacturage solidaire sur XRPL : état du projet

> Dernière mise à jour : vendredi 20 nov. 2026, ~16h15 (Bari).
> Ce document rassemble tout ce qu'on a décidé, vérifié et prévu. Les points marqués **[À VALIDER]** n'ont pas encore été tranchés par l'équipe.

---

## 0. En bref

- **Quoi :** une plateforme d'affacturage tokenisé, en mode hack4good. Des coopératives sociales s'occupent d'enfants (crèches, éducateurs pour élèves handicapés, centres d'été) et sont payées en retard par les communes. Elles tokenisent leurs factures en MPT et obtiennent un prêt XLS-66 en quelques minutes. Le prêt est financé par un Vault (XLS-65) d'investisseurs à impact, protégé par une fondation qui prend les premières pertes.
- **La crypto :**
  - une preuve **ZK (Noir)** montre que la facture est valide sans la révéler ;
  - un **nullifier** enregistré on-chain bloque le double-financement ;
  - des **paiements confidentiels (XLS-96)** couvrent le règlement par la commune et les salaires.
- **Le track :** Track 3 (tokenisation), avec assez de profondeur crypto pour parler au jury cryptographe (De Componendis Cifris).
- **Le réseau :** objectif alphanet. L'URL est introuvable pour l'instant. Repli sur le devnet public.
- **Prochaines actions :**
  1. trouver l'URL de l'alphanet et vérifier `LendingProtocolV1_2` ;
  2. commencer à coder sur devnet sans attendre ;
  3. trancher la couche crypto ;
  4. répartir les chantiers.

---

## 1. Contexte du hackathon

| | |
|---|---|
| Événement | IXH26 · Italian XRPL Hackathon |
| Lieu | Bari, Università degli Studi di Bari |
| Dates | 20–21 nov. 2026 selon certaines sources, 21–22 selon XRPL Commons. Nous y sommes. |
| Organisateurs | XRPL Commons, UBRI (Ripple), Université de Bari, Université de Trento, **De Componendis Cifris** (association italienne de cryptographie) |
| Équipes | 3 à 8 personnes |
| Prix | 12 000 € au total. Par track : 2 000 € / 1 200 € / 800 € |
| Tracks | Cryptographie avancée · Applications XRPL · Tokenisation. **La numérotation 1/2/3 est à confirmer sur Luma.** |
| Notre track | **Tokenisation** (track 3 supposé) |

Le jury compte des cryptographes. Une idée de tokenisation qui montre de la vraie crypto marque des points.

---

## 2. Historique des décisions

| # | Décision | Statut |
|---|---|---|
| 1 | Viser surtout le Track 3 (tokenisation), en gardant un œil sur les tracks 1 et 2 | ✅ |
| 2 | Sujet : **tokenisation de factures + lending (XLS-65/66) + MPT + Confidential MPT + ZK/FHE**, avec une image hack4good | ✅ |
| 3 | Le FHE ne suffit pas à « tout chiffrer » et ne remplace pas le ZK (voir §9.6) | ✅ compris |
| 4 | Bénéficiaires : **coopératives sociales qui s'occupent d'enfants, payées en retard par les communes**. Les idées « bons enfance » et « vérification d'âge » ont été écartées. | ✅ |
| 5 | Structure : **prêt pro-solvendo XLS-66 garanti par la facture**. Le MPT facture est cédé au broker, et une fondation prend les premières pertes (*blended finance*). | ✅ proposé, pas contesté |
| 6 | CheckFi (1er prix à Paris Blockchain Week en avril 2026, affacturage confidentiel) n'est pas un problème. **Notre différence : le vrai lending XLS-66 sur les MPT**, plus le reste (§6). | ✅ |
| 7 | KYB obligatoire, porté par des Credentials XLS-70 | ✅ |
| 8 | **Tout faire sur l'alphanet** (décision de l'équipe) | ⚠️ bloqué : endpoint introuvable (§12) |
| 9 | Couche crypto : ZK (Noir) + registre en credentials. Phala est une option. Zama est écarté. | **[À VALIDER]** |
| 10 | Anti double-financement : partir de l'idée « mémo + hash », en version améliorée (§9.3) | **[À DISCUTER]** |

---

## 3. Le problème

1. En Italie, les **communes sous-traitent les services à l'enfance** à des **coopératives sociales** : crèches municipales, éducateurs d'accompagnement pour élèves handicapés, périscolaire, centres d'été.
2. **Les communes paient tard**, surtout dans le Sud. L'Italie a été condamnée par la Cour de justice de l'UE en 2020 pour les retards de paiement de ses administrations.
3. Une coop a **des coûts presque entièrement salariaux**, à payer chaque mois, alors que la commune paie des mois plus tard.
4. **Les banques prêtent peu** à des structures sans actifs à mettre en garantie. **L'affacturage classique ne rentabilise pas** les petites factures, et la cession de créances sur l'administration est lourde.
5. Résultat : **salaires en retard, services suspendus, crèches qui ferment**. **Ce sont les enfants qui en paient le prix.**

Phrase de pitch : *« Une crèche ne devrait pas fermer parce que la mairie paie en retard. »*

---

## 4. La solution

Un pool de prêt à impact on-chain :

- **Côté capital :** une fondation, par exemple une fondation bancaire italienne, apporte le capital **first-loss**. Des investisseurs à impact apportent le capital principal dans un **Vault privé et fermé** en stablecoin MPT.
- **Côté coop :** une coop vérifiée par **KYB** tokenise une facture **certifiée par la commune**. Elle prouve en **ZK** que la facture est valide et pas déjà financée, sans rien révéler.
- **Le prêt :** elle reçoit **~85 % de la facture en quelques minutes** au lieu d'attendre 150 jours.
- **À l'échéance :** la commune paie, la coop rembourse, les investisseurs récupèrent capital et intérêts. Le capital de la fondation est réutilisé pour la cohorte suivante.
- **Les données sensibles**, qui peuvent concerner des enfants handicapés, **ne touchent jamais la chaîne**. On ne publie que des engagements (hashes) et des preuves.
- **Les salaires** sont payés en **confidentiel**.

---

## 5. Cas d'usage

1. **Crèche municipale à Bari.**
   - Facture de 48 000 € pour le trimestre, payable à 150 jours. 12 éducatrices à payer chaque mois.
   - La coop reçoit 40 800 € (85 %) en une transaction.
2. **Éducateurs de soutien scolaire.**
   - Une facture par mois à la commune, financée de façon récurrente.
   - La confidentialité est indispensable : la facture permet de remonter jusqu'à des élèves handicapés.
3. **Centre d'été.**
   - Gros besoin de trésorerie en juin pour les salaires, alors que la commune paie en octobre.
4. **Côté prêteurs.**
   - Une fondation met 100 k€ en first-loss, ce qui permet à des investisseurs éthiques de déposer 1 M€ avec un risque réduit.
   - Ils obtiennent un rendement et un rapport d'impact du type « X crèches restées ouvertes ».

---

## 6. Ce qui nous distingue de CheckFi

CheckFi est un affacturage confidentiel sur XRPL : champs masqués, scoring ZK avec RISC Zero, Vault avec parts en MPT.

| | CheckFi | Nous |
|---|---|---|
| Financement | Le Vault achète la facture à prix réduit | **Prêt natif XLS-66** (LoanBroker, Loan, échéancier, défaut) |
| Pertes | — | **Fondation en first-loss** (`LoanBrokerCoverDeposit`) |
| Double-financement | ? | **Nullifier + registre à unicité garantie par le ledger** |
| Confidentialité des paiements | — | **Confidential MPT (XLS-96)** : règlement par la commune et salaires |
| Conformité | — | **KYB par Credentials** dont l'expiration suit le DURC, Vault privé avec domaine |
| Débiteur | Générique | **Administration publique** (attestation de type PCC) |
| Récit | Fintech | **Hack4good, enfants, données de mineurs protégées** |

---

## 7. Architecture

### 7.1 Acteurs et comptes XRPL

| Acteur | Rôle | Compte(s) |
|---|---|---|
| Plateforme | Propriétaire du Vault et du LoanBroker, cosigne les prêts, vérifie les preuves | `platform` (+ pseudo-comptes Vault et Broker créés par le ledger) |
| Émetteur KYB | Émet les credentials KYB et KYC | `kyb_issuer` |
| Attesteur | Commune ou plateforme de certification PCC (simulée) : signe les attestations de créance | Clé ECDSA hors ledger (pas besoin de compte) |
| Registre | Registre anti double-financement | `registry` + `registry_anchor` (sujet des credentials) |
| Émetteur du stablecoin | Émet le stablecoin MPT de test (« EURc ») | `stable_issuer` |
| Auditeur | A la clé de déchiffrement auditeur du stablecoin, par exemple l'autorité de contrôle | Clé ElGamal |
| Fondation | Apporte la first-loss | `foundation` |
| Investisseurs | Déposent dans le Vault | `investor_1..n` |
| Coopérative | Emprunteuse et émettrice du MPT facture | `coop` |
| Commune | Débitrice, paie la facture | `comune` |
| Éducatrices | Reçoivent les salaires en confidentiel | `educ_1..n` |

### 7.2 Amendments utilisés

| Amendment | Usage chez nous |
|---|---|
| **MPTokensV1** (XLS-33) | Stablecoin + MPT facture (1 unité par facture) |
| **ConfidentialTransfer** (XLS-96) | Paiement de la commune vers la coop, salaires, vue auditeur |
| **SingleAssetVault** (XLS-65) | Vault privé fermé = cohorte de factures |
| **LendingProtocol + V1_1** (XLS-66) | LoanBroker, first-loss, prêts, remboursement, défaut |
| **LendingProtocolV1_2** | *Alphanet seulement, si activé :* Vault et Loan dans un Batch, LoanBroker privé avec domaine |
| **Credentials** (XLS-70) | KYB, KYC, fondation, **et registre anti double-financement** |
| **PermissionedDomains** (XLS-80) | Accès au Vault réservé aux prêteurs KYC |
| **Batch** (BatchV1_1 + fixBatchV1_2) | Opération atomique « enregistrer + mint + céder », Batch de salaires confidentiels |
| TokenEscrow (XLS-85) | Option : séquestre du MPT facture (verrou par hash) |

### 7.3 Ce qui est public et ce qui est caché

| Donnée | Visibilité |
|---|---|
| Identité de la coop (compte + credential KYB) | Publique |
| **Montant du prêt** (`PrincipalRequested`) | **Publique.** Il révèle à peu près la valeur de la facture (≈ montant du prêt / 0,85). À assumer dans le pitch. |
| Échéance du prêt | Publique |
| **Commune débitrice** | **Cachée** (appartenance Merkle en ZK) |
| **Montant exact, numéro, contrat, service, enfants concernés** | **Cachés** (off-chain chiffré, on-chain seulement un engagement) |
| Valeur de la facture dans l'offre du MPT | Cachée (`MaximumAmount = 1`) |
| Paiement de la commune à la coop | **Montant caché** (ConfidentialMPTSend). Visible seulement par l'émetteur et l'auditeur. |
| Salaires | **Montants cachés** |
| Conversions public ↔ confidentiel | **Montant public.** La commune doit convertir en gros (budget mensuel). |
| Total en circulation du stablecoin | Public (`OutstandingAmount` + `ConfidentialOutstandingAmount`) |

---

## 8. Le flow détaillé

> Le Vault fermé a 3 phases : **souscription** (dépôts seulement), **investissement** (prêts seulement, sans dépôt ni retrait), **rachat** (retraits seulement). Il faut au minimum **180 s** entre la date de souscription et la date de rachat, donc **une cohorte de 90 jours se compresse en ~15 min pour la démo**.

### Étape 0 · Mise en place (plateforme, une seule fois)

1. **Stablecoin :** `MPTokenIssuanceCreate` par `stable_issuer`.
   - Options `tfMPTCanTransfer` (0x20, obligatoire pour un actif de Vault) et `tfMPTCanHoldConfidentialBalance` (0x80).
   - **Pas de `TransferFee`**, c'est incompatible avec le confidentiel.
   - Pas de `RequireAuth` pour la démo, ça évite d'avoir à autoriser le pseudo-compte du Vault.
2. **Clés de chiffrement :** `MPTokenIssuanceSet` avec `IssuerEncryptionKey` et `AuditorEncryptionKey`. Avec une clé auditeur, chaque conversion doit aussi fournir `AuditorEncryptedAmount`.
3. **Domaine prêteurs :** `PermissionedDomainSet`, qui accepte `{kyb_issuer, KYC_INVESTOR}` et `{kyb_issuer, FOUNDATION}`.
4. **Vault :** `VaultCreate` par `platform`.
   - `Asset` = le stablecoin, options `tfVaultPrivate` et `DomainID` = domaine prêteurs.
   - **`VaultKind: 1`** (fermé), `SubscriptionDate` = T+3 min, `RedemptionDate` = T+18 min.
   - Les parts du Vault sont elles-mêmes des MPT.
5. **Broker :** `LoanBrokerSet` par `platform` avec le `VaultID`. Il n'est accepté que si le Vault est fermé.
6. **Registre :** créer et financer `registry` et `registry_anchor`.

### Étape 1 · KYB et KYC

- **Coop, off-chain :**
  - **appel réel à VIES** (API publique de l'UE) pour valider le numéro de TVA ;
  - extrait du Registro Imprese simulé : forme juridique « coopérative sociale » ;
  - KYC du représentant légal, bénéficiaires effectifs, sanctions ;
  - **DURC** (attestation de régularité des cotisations sociales, valable 120 jours).
- **Coop, on-chain :**
  - `CredentialCreate` par `kyb_issuer` : `Subject=coop`, `CredentialType=hex("KYB_COOP_SOCIALE")`, **`Expiration` = expiration du DURC**, `URI` = hash du dossier off-chain ;
  - la coop fait un `CredentialAccept`.
- **Investisseurs et fondation :** même chose avec `KYC_INVESTOR` et `FOUNDATION`. Ils font partie du domaine prêteurs dès que leur credential est accepté.
- **Pourquoi le DURC compte :** une administration ne paie pas un fournisseur dont le DURC est irrégulier. Quand le credential expire, le broker refuse de cosigner. Sur l'alphanet avec V1_2, ce serait même le ledger qui refuserait.

### Étape 2 · Dépôts (phase de souscription)

- Les investisseurs font un `VaultDeposit` et reçoivent des parts MPT. Le ledger vérifie leur credential dans le domaine.
- La fondation verse sa part à `platform`, puis `platform` fait le `LoanBrokerCoverDeposit`. **Seul le propriétaire du broker peut déposer la first-loss**, c'est vérifié dans le code.

### Étape 3 · Attestation et preuve ZK

1. **Ce qu'on hashe :** la coop a livré le service. Les champs **normalisés** de la facture sont : TVA de la coop, **code IPA** de la commune, numéro, date, montant, échéance, type de service.
2. **L'attestation :** l'attesteur (commune ou PCC simulée) calcule `N = HMAC(clé_secrète_attesteur, champs normalisés)`, puis signe `H(champs ‖ N)` en ECDSA. Pourquoi N est calculé ainsi : voir §9.3.
3. **La preuve :** le navigateur de la coop génère une **preuve Noir** (détail en §9.1).
4. **La vérification :** la plateforme vérifie la preuve off-chain. Elle **publie la preuve et la clé de vérification** pour que n'importe qui puisse la revérifier.

### Étape 4 · Mint et cession en Batch atomique

Un `Batch` multi-comptes en mode `tfAllOrNothing` (0x10000). Les comptes autres que l'émetteur du Batch signent dans `BatchSigners`.

| # | Compte | Transaction | But |
|---|---|---|---|
| 1 | `registry` | `CredentialCreate` avec `Subject=registry_anchor`, **`CredentialType = N`** (32 octets, max 64) | Enregistrer la facture. **Si elle existe déjà : `tecDUPLICATE`, et tout le Batch échoue.** |
| 2 | `coop` | `MPTokenIssuanceCreate` du MPT facture (détail ci-dessous) | Tokeniser |
| 3 | `platform` | `MPTokenAuthorize` sur l'ID du MPT facture | Permettre au broker de détenir le MPT. **L'ID se calcule à l'avance** : séquence (4 octets, big-endian) + compte (vérifié dans le code). |
| 4 | `coop` | `Payment` d'une unité vers `platform` | **Cession de la créance** |

Le MPT facture :
- `MaximumAmount = 1` et `AssetScale = 0`, pour que l'offre ne révèle pas le montant ;
- **pas de `CanTransfer`** : le MPT ne peut aller que de l'émetteur au détenteur et revenir, donc le broker ne peut pas le recéder à un tiers ;
- pas de `CanClawback` ni de `CanLock` ;
- `MPTokenMetadata` (1024 octets max) au format JSON : `{N, C, lien vers la preuve, hash de la clé de vérification, échéance, clé de l'attesteur, racine de la liste des communes}`.

**Démo forte :** on rejoue le même Batch avec la même facture. Le ledger renvoie `tecDUPLICATE` et rien n'est créé. Le double-financement est bloqué en direct.

### Étape 5 · Prêt (phase d'investissement)

- **Sur devnet :** `LoanSet` **hors Batch**, juste après l'étape 4. Il est interdit dans un Batch tant que `LendingProtocolV1_2` n'est pas activé.
- **Sur l'alphanet avec V1_2 :** le `LoanSet` peut être la 5e transaction du Batch. Il doit contenir le champ **`Counterparty`**, et la coop signe le Batch en `BatchSigner`.
- **Paramètres :**
  - `LoanBrokerID` ;
  - `PrincipalRequested` = 85 % de la facture ;
  - `InterestRate` ;
  - `PaymentTotal = 1` et `PaymentInterval` = durée jusqu'à l'échéance ;
  - `GracePeriod`, `LateInterestRate` ;
  - **`Data`** = référence vers le MPT facture et N.
- **Signatures :** la plateforme cosigne (`CounterpartySignature`) seulement après avoir vérifié le credential KYB de la coop (non expiré), la preuve ZK et le registre.
- **Contrainte du ledger :** le dernier remboursement doit tomber **au moins 60 s avant** la date de rachat du Vault.

### Étape 6 · Échéance et paiements confidentiels

1. **La commune** a converti son budget mensuel en confidentiel (`ConfidentialMPTConvert`, montant public, une seule fois). Elle paie la coop en **`ConfidentialMPTSend`**, montant caché.
2. **La coop** fait un `ConfidentialMPTMergeInbox` : les fonds reçus passent de l'inbox au solde dépensable, sans preuve ZK.
3. **Salaires :** un Batch de `ConfidentialMPTSend` vers les éducatrices. **À tester** : il faut que chaque preuve parte du solde laissé par l'envoi précédent dans le même Batch.
4. **Remboursement :** `ConfidentialMPTConvertBack` du montant à rembourser (public), puis **`LoanPay`**. Sur l'alphanet avec V1_2, les deux peuvent aller dans un seul Batch.
5. **Retour de la facture :** `platform` renvoie l'unité du MPT facture à la coop, ce qui la brûle. La coop peut ensuite faire un `MPTokenIssuanceDestroy`.
6. **Le registre garde N**, avec le statut « financé, soldé ».

### Étape 7 · Retard, défaut, rachat

- **Retard :** l'échéance passe, puis la période de grâce. `LoanManage` avec `tfLoanImpair` n'est possible **qu'une fois le paiement en retard** (sinon `tecTOO_SOON`). Puis `tfLoanDefault`, réservé au propriétaire du broker.
- **Défaut :** la **first-loss absorbe** la perte. Le broker garde le MPT facture, c'est-à-dire la créance sur la commune, et la recouvre off-chain. Une administration paie en retard mais finit presque toujours par payer.
- **Rachat :** après `RedemptionDate`, les investisseurs font des `VaultWithdraw` et récupèrent capital et intérêts.

---

## 9. La couche crypto

### 9.1 La preuve ZK (Noir)

**Outils :** Noir pour le circuit, Barretenberg (`bb.js`) pour prouver dans le navigateur ou dans Node. Hash Poseidon pour les engagements. Vérification ECDSA secp256k1 dans le circuit.

| | Contenu |
|---|---|
| **Entrées privées** | Champs normalisés de la facture, signature de l'attesteur, chemin Merkle de la commune, sel |
| **Entrées publiques** | Adresse de la coop, `PrincipalRequested`, échéance, **N**, **C**, clé publique de l'attesteur, racine Merkle des communes éligibles |

**Ce que le circuit vérifie :**
1. la signature de l'attesteur est valide sur `H(champs ‖ N)` ;
2. la commune (code IPA) fait partie de la liste des communes éligibles (appartenance Merkle) ;
3. **`PrincipalRequested × 100 ≤ montant × 85`**, c'est-à-dire que le prêt ne dépasse pas 85 % de la facture, **sans révéler le montant** ;
4. l'échéance publique est bien celle de la facture ;
5. `C = Poseidon(champs, sel)`, l'engagement publié dans le MPT ;
6. la TVA de la facture est celle de la coop qui a passé le KYB ;
7. la preuve est **liée à l'adresse de la coop**, donc personne ne peut la réutiliser.

**Vérification :** off-chain par la plateforme. La preuve et la clé de vérification sont publiées, donc n'importe qui peut la revérifier.

### 9.2 Pourquoi l'attestation est simulée

- **Dans la réalité :**
  - une FatturaPA est un XML signé en RSA-2048 avec un certificat qualifié ;
  - la plateforme PCC émet un document de certification signé.
- **Le problème en ZK :** vérifier ça dans un circuit demande de lire du XML, de calculer du SHA-256 sur plusieurs Ko, de vérifier du RSA et une chaîne de certificats. Ça représente des millions de contraintes et des semaines de travail. Anon Aadhaar et zkPassport le font, mais ce sont des projets à part entière.
- **Le point de fond :** la signature de la coop sur sa propre facture **ne prouve rien**, n'importe qui peut signer sa propre facture. Ce qui compte, c'est que **la commune reconnaisse sa dette**, ce que fait la certification PCC.
- **Dans la démo :** un service « attesteur » simulé signe un message court en ECDSA. Ça coûte quelques dizaines de milliers de contraintes, et la preuve se génère en quelques secondes. Pour le pitch, on présente le passage aux vraies signatures RSA comme la feuille de route vers la production.

### 9.3 Anti double-financement : l'idée « mémo + hash » et sa version améliorée

**L'idée de départ (équipe) :** chaque plateforme publie dans un mémo le hash de la facture. Si toutes utilisent la même fonction de hash, la même facture donne le même hash, et on détecte les doublons on-chain.

**C'est la bonne intuition : c'est exactement un nullifier.** Il faut régler quatre problèmes :

| Problème | Explication | Solution |
|---|---|---|
| **1. Normalisation** | Hasher le PDF ou le XML ne marche pas : un espace en plus donne un autre hash, et la facture peut être refinancée | Hasher **uniquement les champs normalisés** (TVA, code IPA, numéro, année), après mise en forme (majuscules, format de date…) |
| **2. Attaque par dictionnaire** | Ces champs sont faciles à deviner : les TVA sont publiques et les numéros de facture se suivent. N'importe qui peut calculer `H(coop X, commune Y, n°1..1000)` et découvrir qui finance quoi chez qui. **Un sel aléatoire casse l'unicité**, puisque deux sels donnent deux hashes. | **`N = HMAC(clé secrète de l'attesteur, champs)`**. La commune ou la PCC donne toujours le même N pour la même facture, et personne d'autre ne peut le calculer. La preuve ZK vérifie que le N publié est bien celui signé par l'attesteur. |
| **3. Un mémo n'empêche rien** | N'importe qui peut poster deux fois le même hash. Pour détecter un doublon il faut scanner tout l'historique, car **XRPL n'indexe pas le contenu des mémos**. Et si deux plateformes vérifient en même temps, elles peuvent toutes les deux financer. | Utiliser un objet du ledger **dont l'unicité est garantie par le consensus** (ligne suivante) |
| **4. Registre natif** | — | **Un credential sert de registre.** L'identifiant d'un credential est formé du sujet, de l'émetteur et du type, et un doublon est refusé avec **`tecDUPLICATE`** (vérifié dans le code). On met **N dans `CredentialType`**, avec `Subject = registry_anchor` et `Issuer = registry`. **Pas de course possible** (l'ordre est fixé par le consensus), **vérification en un seul appel `ledger_entry`**, sans scan. Dans un Batch `AllOrNothing`, un doublon annule aussi le mint et la cession. |

**Limites restantes :**
- seuls le sujet et l'émetteur peuvent supprimer le credential, donc **qui contrôle `registry` ?** Pour la démo, la plateforme. En production, un **multisig de plateformes** (SignerList native) ou l'attesteur. Toute suppression reste visible dans l'historique ;
- chaque credential immobilise une réserve en XRP. C'est négligeable pour la démo ;
- le registre ne protège qu'entre plateformes qui le consultent. Le pitch le présente comme un standard ouvert.

**[À DISCUTER]** : l'équipe avait une autre idée de départ. On la compare à cette version.

### 9.4 Confidential MPT (XLS-96) : usage et limites

- **Les primitives :**
  - les soldes sont chiffrés en **EC-ElGamal**, additivement homomorphe ;
  - **une preuve de Schnorr** accompagne l'enregistrement d'une clé ;
  - une **Bulletproof agrégée de 754 octets** prouve que le montant et le solde restant sont dans [0, 2^64) ;
  - des **preuves d'égalité** montrent que le même montant est chiffré pour le détenteur, l'émetteur et l'auditeur.
- **Les transactions :** `ConfidentialMPTConvert`, `ConvertBack`, `Send`, `MergeInbox`, `Clawback`, `HolderKeyUpdate`, `MirrorUpdate`.
- **Les champs du ledger :** `ConfidentialBalanceInbox`, `ConfidentialBalanceSpending`, `AuditorEncryptedBalance`, et `ConfidentialOutstandingAmount` (agrégat public).
- **⚠️ Seuls les paiements directs sont confidentiels.** **Vault, prêt et remboursement restent publics** : ils utilisent le solde public du même MPT. Rien dans le code n'empêche un MPT confidentiel d'être l'actif d'un Vault (vérifié). À confirmer en live avec le script.
- **Outils :** les helpers confidentiels d'`xrpl` JS et la librairie `mpt-crypto` (voir le tuto xrpl.org « Send Confidential MPT Payments »).
- **Bonus homomorphe** (chiffrement additif, **pas** du FHE) : additionner des montants chiffrés par commune pour mesurer une exposition agrégée, que seul l'auditeur déchiffre.

### 9.5 Options : Zama, Phala, ZK vérifié on-chain

| Option | Verdict | Détail |
|---|---|---|
| **ZK vérifié on-chain sur XRPL** | ❌ sur devnet | Pas de smart contracts. Les escrows WASM et `SmartContract` existent **sur l'alphanet**, mais c'est trop risqué pour le cœur de la démo. |
| **Vérificateur sur la sidechain XRPL EVM** | 🟡 possible | Noir génère un vérificateur Solidity. On ancre le hash de la transaction de vérification dans les métadonnées du MPT. Ça ajoute une deuxième chaîne. |
| **Phala (TEE)** | 🟢 le plus réaliste | Un conteneur tourne dans une enclave matérielle (Intel TDX) avec une attestation à distance. On y place le vérificateur ZK, le contrôle du registre et le KYB. Une clé détenue par l'enclave signe le cosignataire du `LoanSet` et le credential du registre. La vérification devient « off-chain mais attestée ». La confiance repose sur le matériel Intel et pas sur les maths, mais ça s'intègre en 3-4 h. |
| **Zama (FHE)** | 🔴 écarté | Le FHE **calcule** sur des données chiffrées, mais il ne **prouve** ni l'authenticité ni l'absence de double-financement. Le KMS de Zama n'existe que sur EVM. Seul usage possible : un scoring chiffré avec Concrete ML, mais il reste le problème de savoir qui déchiffre le score et pourquoi le croire. |

**Recommandation [À VALIDER] :** ZK (Noir) + registre en credentials, avec Phala si quelqu'un a 3-4 h à y consacrer. Zama de côté.

### 9.6 Idées fausses déjà corrigées

1. **« Les paramètres du MPT sont des hashes que Zama peut déchiffrer »** : faux. **Un hash ne se déchiffre pas**, il est à sens unique. On met soit un hash (engagement), soit un ciphertext.
2. **« On met les données FHE dans le MPT »** : impossible. `MPTokenMetadata` est limité à **1024 octets** (vérifié), alors qu'un ciphertext TFHE pèse plusieurs Ko au minimum. Il faut le stocker off-chain et ne mettre que son hash on-chain.
3. **« Si on chiffre les métadonnées, le prêt est caché »** : faux. Les montants de `LoanSet`, de `LoanPay` et des dépôts dans le Vault sont lus **en clair** par les validateurs. rippled ne sait pas calculer sur du FHE.
4. **« Zama déchiffre »** : faux. C'est **celui qui détient la clé secrète** qui déchiffre.
5. **« Le FHE peut remplacer le ZK »** : non. Le FHE sert à calculer, le ZK sert à prouver.

---

## 10. Le KYB en détail

| Vérification | Source réelle | Dans la démo |
|---|---|---|
| Le numéro de TVA existe et correspond à la raison sociale | **VIES** (API publique et gratuite de l'UE) | ✅ **Vrai appel** |
| Forme juridique « coopérative sociale », bon état | Registro Imprese (InfoCamere), registre des coopératives | Simulé |
| Représentant légal | KYC sur pièce d'identité | Simulé |
| Bénéficiaires effectifs | Registre des bénéficiaires effectifs | Simulé |
| Sanctions | Listes UE et ONU | Simulé |
| **DURC** (cotisations sociales à jour, valable 120 j) | INPS / INAIL | Simulé, **sert de date d'`Expiration` du credential** |

**On-chain :** `CredentialCreate` (type `KYB_COOP_SOCIALE`, `Expiration` = expiration du DURC, `URI` = hash du dossier, 256 octets max), puis `CredentialAccept`.

**Où le KYB est vérifié :**
- **pour les prêteurs :** par le ledger, grâce au domaine du Vault (`VaultDeposit`) ;
- **pour les emprunteurs sur devnet :** par la plateforme avant de cosigner le `LoanSet`. Le LoanBroker privé avec `DomainID` exige `LendingProtocolV1_2` ;
- **pour les emprunteurs sur l'alphanet avec V1_2 :** par le ledger, avec un LoanBroker privé et `DomainID` = domaine des emprunteurs.

Le ZK n'apporte rien au KYB : les données d'une entreprise sont publiques. On garde le ZK pour la facture.

---

## 11. Faits techniques vérifiés dans le code rippled

Sources lues : `develop` (commit 81878aa du 19 nov. 2026), la release **3.4.1**, et la branche **`alphanet`** (e94e578, assemblée par Denis Angell le 5 nov. 2026).

| Fait | Fichier | Résultat |
|---|---|---|
| Amendments supportés en 3.4.1 | `features.macro` | `ConfidentialTransfer`, `LendingProtocol`, `LendingProtocolV1_1`, `SingleAssetVault`, `BatchV1_1`, `fixBatchV1_2`, `Credentials`, `PermissionedDomains`, `MPTokensV1`, `TokenEscrow` : tous supportés. **`LendingProtocolV1_2` n'est pas supporté** (ni sur `develop` ni en 3.5.0-rc1). `MPTokensV2` non plus. |
| `LoanSet` dans un Batch | `Batch.h` → `kDisabledTxTypes` | ❌ **Refusé** (`temINVALID_INNER_BATCH`) tant que `LendingProtocolV1_2` n'est pas activé. Concerne aussi `VaultCreate`, `VaultSet`, `VaultDelete`, `VaultDeposit`, `VaultWithdraw`, `VaultClawback`, toutes les transactions `LoanBroker*`, `LoanSet`, `LoanDelete`, `LoanManage`, `LoanPay`. |
| `LoanSet` dans un Batch avec V1_2 | `LoanSet.cpp`, `Batch.cpp` | Le champ **`Counterparty` est obligatoire** (sinon `temBAD_SIGNER`), et **la contrepartie doit signer le Batch** (`BatchSigners`) |
| MPT confidentiel comme actif de Vault | `VaultCreate.cpp`, `MPTokenHelpers.cpp` | ✅ Aucune restriction. Seul **`CanTransfer`** est obligatoire (`tecNO_AUTH` sinon). Les actifs émis par un pseudo-compte (parts d'un autre Vault, LP tokens) sont refusés. |
| Confidentiel et `TransferFee` | `MPTokenIssuanceCreate.cpp`, `MPTokenIssuanceSet.cpp` | ❌ Incompatibles (`temBAD_TRANSFER_FEE` / `tecNO_PERMISSION`) |
| Conversion en confidentiel | `ConfidentialMPTConvert.cpp` | Exige l'option sur l'émission et une **`IssuerEncryptionKey`**. Avec une `AuditorEncryptionKey`, `AuditorEncryptedAmount` devient obligatoire. |
| LoanBroker sur un Vault ouvert | `LoanBrokerSet.cpp` | ❌ `tecNO_PERMISSION` : **un Vault fermé est obligatoire** (V1_1) |
| `DomainID` sur un LoanBroker | `LoanBrokerSet.cpp` | Exige **V1_2**. Ensuite, `LoanSet` vérifie que l'emprunteur fait partie du domaine (`verifyValidDomain`). |
| `LoanBrokerCoverDeposit` | `LoanBrokerCoverDeposit.cpp` | **Propriétaire du broker uniquement** |
| Phases du Vault fermé | `LoanSet.cpp`, `VaultDeposit.cpp`, `VaultWithdraw.cpp` | Souscription : prêt refusé (`tecTOO_SOON`). Investissement : dépôt refusé (`tecEXPIRED`), retrait refusé (`tecTOO_SOON`). Rachat : prêt refusé (`tecEXPIRED`). |
| Durée d'une cohorte | `Protocol.h`, `VaultHelpers.cpp` | Entre **180 s** et 30 ans entre souscription et rachat. Le dernier remboursement doit tomber **au moins 60 s avant** le rachat. |
| `VaultKind` | `Protocol.h` | 0 = ouvert, **1 = fermé**. `DomainID` n'est possible qu'avec `tfVaultPrivate`. |
| Unicité des credentials | `CredentialCreate.cpp` | Identifiant formé du sujet, de l'émetteur et du type → **`tecDUPLICATE`**. Le sujet doit exister et ne pas être un pseudo-compte. |
| Suppression d'un credential | `CredentialDelete.cpp` | Le sujet ou l'émetteur peut le supprimer à tout moment. Les autres seulement s'il a expiré. |
| Taille de `CredentialType` | `Protocol.h` | 64 octets max |
| Taille de `MPTokenMetadata` | `Protocol.h` | **1024 octets** max |
| ID d'une émission MPT | `Indexes.cpp` (`makeMptID`) | **Séquence (big-endian) + compte → calculable à l'avance** |
| Impairment et défaut | `LoanManage` + XLS-66 | Propriétaire du broker uniquement. Impairment possible seulement **une fois en retard**. Défaut après l'échéance plus la période de grâce. |
| Support dans xrpl.js | `xrpl@5.4.0-beta.0` | Contient tous les types (Vault*, Loan*, Confidential*, Batch) et les champs `VaultKind`, `SubscriptionDate`, `RedemptionDate`, `IssuerEncryptionKey`, `AuditorEncryptionKey`, `Counterparty`, `CounterpartySignature`, `Data` (LoanSet). Options : `tfLoanImpair`, `tfLoanDefault`, `tfVaultPrivate`, `tfVaultShareNonTransferable`. |

---

## 12. Le réseau : alphanet ou devnet

### Ce qu'on sait de l'alphanet
- **Le code :** la branche `alphanet` de XRPLF/rippled est l'assemblage, fait le **5 nov. 2026** par **Denis Angell**, de `develop` (b001f58) et de **18 branches expérimentales** : smart contracts, post-quantique, coupons, accrual des Vaults, MPT structured data, confidential voting, perpetual futures, etc. **15 des 18 fusions ont des conflits résolus par IA.**
- **La compilation** utilise **`force_supported: ON`**, donc **tous les amendments sont supportés, y compris `LendingProtocolV1_2`**. Sur l'alphanet, `LoanSet` (et Vault, `LoanPay`…) **peut** donc entrer dans un Batch, **si V1_2 y est activé**.
- **Statut en direct inconnu :**
  - `wss://alphanet.xrpl.org` (l'URL donnée par le README du repo réseau) **ne répond pas** depuis le cloud ni depuis le Mac de l'équipe (`network error or non-101`) ;
  - le repo `XRPLF/xrplf-alphanet-network` est **privé** (404) ;
  - l'ancienne URL donnée dans l'article de Denis (2025) est `wss://alphanet.nerdnest.xyz`. Non testée sur le Mac.
  - Denis n'est pas mentor ici.

### Prochaines étapes réseau
1. Lancer la commande qui teste 4 URLs (§18).
2. Demander l'URL de l'alphanet et du faucet aux organisateurs : stand XRPL Commons ou Discord du hackathon.
3. Vérifier l'onglet `[mosh] alp…` du terminal : si c'est une machine de l'alphanet, y lancer `xrpld feature LendingProtocolV1_2`.
4. **En attendant, coder sur le devnet public** (`wss://s.devnet.rippletest.net:51233`), avec **l'URL du réseau dans une variable d'environnement** (`XRPL_WS`). Si l'alphanet casse, on change une ligne.

### Ce qui change selon le réseau

| | Devnet | Alphanet avec V1_2 |
|---|---|---|
| Mint et cession atomiques (étape 4) | ✅ | ✅ |
| `LoanSet` dans le même Batch | ❌ deux étapes | ✅ **tout atomique** |
| `ConvertBack` + `LoanPay` en Batch | ❌ | ✅ |
| KYB des emprunteurs imposé par le ledger | ❌ (vérifié par la plateforme) | ✅ (LoanBroker privé avec `DomainID`) |
| Stabilité | Bonne | Expérimentale |

---

## 13. Plan de travail proposé **[À VALIDER : répartition]**

### 13.1 Vérifications de la première heure
- [ ] URL de l'alphanet trouvée, avec la liste des amendments activés (`LendingProtocolV1_2`, `ConfidentialTransfer`, `SingleAssetVault`, `LendingProtocolV1_1`, `BatchV1_1`, `Credentials`, `PermissionedDomains`).
- [ ] `node check-devnet.mjs <url>` passe sur le réseau choisi : MPT confidentiel → Vault fermé → LoanBroker ; LoanBroker sur un Vault ouvert refusé ; test du Batch avec `LoanSet`.
- [ ] Faucet du réseau choisi accessible.
- [ ] Tuto xrpl.org Confidential MPT exécuté une fois de bout en bout (Convert → Send → MergeInbox).

### 13.2 Chantiers (pour 3 à 8 personnes)

| Chantier | Contenu | Profil |
|---|---|---|
| **A. Cœur XRPL** | Script de mise en place (stablecoin, clés, domaine, Vault, broker, first-loss) ; credentials ; Batch mint + cession + registre ; `LoanSet` ; remboursement ; défaut ; rachat | Dev TS/JS à l'aise avec xrpl.js |
| **B. Confidential** | Clés ElGamal des comptes, Convert, Send, MergeInbox, ConvertBack ; Batch de salaires ; vue auditeur (déchiffrement) | Dev + un peu de crypto |
| **C. ZK** | Circuit Noir (§9.1), service attesteur simulé (ECDSA + HMAC pour N), arbre Merkle des communes, preuve dans le navigateur avec `bb.js`, vérification côté serveur | Profil crypto / Rust |
| **D. Backend plateforme** | API KYB (avec un **vrai appel VIES**), vérification des preuves, contrôle du registre, cosignature du `LoanSet`, stockage off-chain chiffré. Option : déploiement dans Phala. | Dev backend |
| **E. Front et démo** | 4 écrans : **coop** (KYB, facture, prêt, paie), **investisseur / fondation** (dépôt, rendement, impact), **auditeur** (déchiffrement), **vue publique** (ce que voit l'explorer : ciphertexts) | Dev front |
| **F. Pitch** | Récit hack4good, chiffres d'impact, tableau public / caché, différences avec CheckFi, feuille de route (vraies signatures RSA, registre multisig, V1_2) | Profil produit / business |

### 13.3 Jalons (relatifs)
1. **J1, base on-chain :** stablecoin, Vault fermé, broker et first-loss en place. Un prêt simple réussit de bout en bout (sans ZK ni confidentiel).
2. **J2, factures :** KYB (avec VIES) + MPT facture + Batch atomique + registre (`tecDUPLICATE` démontré).
3. **J3, crypto :** circuit Noir branché (preuve générée, vérifiée et publiée) + paiements confidentiels de la commune et des salaires + vue auditeur.
4. **J4, cycle complet :** remboursement, retour de la facture, rachat. Scénario de défaut avec first-loss.
5. **J5, finitions :** front, script de démo minuté, slides, vidéo de secours.
6. **Bonus :** tout atomique sur l'alphanet avec V1_2, Phala, agrégation homomorphe par commune.

### 13.4 Script de démo (~4 min, cohorte compressée)
1. **KYB en direct :** on tape un numéro de TVA, VIES le valide, le credential est émis avec l'expiration du DURC.
2. **Phase de souscription :** la fondation (first-loss) et deux investisseurs déposent.
3. **La commune certifie** une facture de crèche. La coop génère la preuve ZK dans le navigateur (quelques secondes).
4. **Batch atomique :** registre + mint + cession. On rejoue la même facture : **`tecDUPLICATE`**, la fraude est bloquée.
5. **Phase d'investissement :** prêt de 85 %, la coop reçoit l'argent.
6. **Échéance :** la commune paie en confidentiel. L'explorer ne montre que des ciphertexts, **l'auditeur déchiffre**. La coop paie ses éducatrices en confidentiel.
7. **Remboursement**, puis rachat : les investisseurs récupèrent capital et intérêts. Écran d'impact : « 1 crèche restée ouverte, 12 salaires payés à temps ».
8. *(Option)* Scénario de défaut : la first-loss absorbe la perte, les investisseurs sont protégés.

---

## 14. Risques et parades

| Risque | Parade |
|---|---|
| L'alphanet est injoignable, instable ou redéployé | Coder sur devnet, URL dans une variable d'environnement, Batch atomique en bonus |
| Bugs dus aux fusions IA de l'alphanet | Tester chaque transaction tôt, garder devnet en secours |
| `ConfidentialMPTSend` en Batch (preuves enchaînées) ne marche pas | Salaires envoyés un par un |
| Un MPT confidentiel refusé en live comme actif de Vault | Deux tokens : un stablecoin public pour le Vault, un confidentiel pour les paiements, avec conversion côté plateforme |
| Circuit Noir trop lent ou bloquant | Réduire le circuit : signature + nullifier d'abord, Merkle et ratio ensuite |
| Le montant du prêt révèle la valeur de la facture | L'assumer dans le pitch (tableau public / caché) ; feuille de route vers des montants arrondis par tranches |
| Deux étapes non atomiques sur devnet (cession, puis prêt) | La plateforme est régulée et fait confiance à la coop ; en option, un `TokenEscrow` avec verrou par hash sur le MPT facture |
| Le jury dit « c'est CheckFi » | Tableau de différences (§6) : vrai lending XLS-66, first-loss, registre natif, Confidential MPT, KYB |
| Juridique : l'affacturage est une activité réglementée, la cession d'une créance publique doit être notifiée, données de mineurs | Le pitch dit : la plateforme est un partenaire agréé, la notification à la commune est hors chaîne, **aucune donnée de mineur on-chain** |

---

## 15. Questions ouvertes

1. **Couche crypto :** ZK + registre seulement, ou + Phala, ou + Zama ? (Reco : ZK + registre, Phala si on a le temps.)
2. **Double-financement :** quelle était l'autre idée de l'équipe ? Qui contrôle le registre : la plateforme, un multisig ou l'attesteur ?
3. **Réseau :** URL et faucet de l'alphanet ? V1_2 activé ?
4. **Paramètres financiers :** taux d'avance (85 % ?), taux d'intérêt, période de grâce, taille de la first-loss.
5. **Équipe :** combien êtes-vous, et qui prend quel chantier (§13.2) ?
6. **Track :** confirmer que la tokenisation est bien le Track 3 et les critères du jury.
7. **Nom du projet :** à trouver.

---

## 16. Éléments de pitch

- **Accroche :** « Une crèche ne devrait pas fermer parce que la mairie paie en retard. »
- **Le problème :** des coopératives sociales qui s'occupent d'enfants, payées à 150 jours, avec des salaires à payer chaque mois.
- **La solution :** un affacturage solidaire on-chain. Les factures certifiées deviennent des MPT, un prêt XLS-66 est versé en minutes, financé par des investisseurs à impact et protégé par une fondation en first-loss.
- **La crypto :** des preuves ZK (facture valide, commune éligible, prêt ≤ 85 %, sans rien révéler), un nullifier à unicité garantie par le ledger contre le double-financement, et des paiements ElGamal confidentiels avec vue auditeur.
- **La conformité :** KYB par Credentials dont l'expiration suit le DURC, Vault réservé aux prêteurs KYC, aucune donnée de mineur on-chain.
- **La stack :** 8 à 9 amendments (MPT, Confidential, Vault, Lending V1.1, Credentials, Permissioned Domains, Batch, et V1_2 sur l'alphanet).
- **Feuille de route :**
  - vraies signatures PCC et SDI en ZK (RSA) ;
  - registre multisig entre plateformes ;
  - LoanBroker privé natif (V1_2) ;
  - montants par tranches ;
  - rotation des clés (XLS-99).

---

## 17. Idées écartées (pour mémoire)

- **DvP confidentiel pour les marchés privés** (Batch de deux `ConfidentialMPTSend`, marché public + dark pool). Bonne idée, mais pas hack4good.
- **Auditeur à seuil pour XLS-96** (DKG, déchiffrement partiel, preuves DLEQ). Pourrait revenir comme bonus crypto.
- **Credentials non traçables en ZK.** Track 1, sans tokenisation.
- **Paie confidentielle pour PME.** Intégrée dans notre étape 6.
- **Bons « enfance » en MPT confidentiel** (éligibilité ISEE prouvée en ZK). Écartée pour garder la facture.
- **Vérification d'âge en ZK.** Track 1, sans tokenisation ni lending.
- **Tout en FHE / Zama.** Ne répond pas au besoin (§9.6).
- **Achat pro-soluto par le Vault.** C'est le modèle de CheckFi, et il n'utilise pas XLS-66.

---

## 18. Outils et commandes

**Script de test complet :** `devnet-check/check-devnet.mjs` (envoyé en pièce jointe). Il :
- liste les amendments activés ;
- crée un MPT confidentiel puis un Vault fermé sur ce MPT ;
- teste le LoanBroker sur un Vault fermé et sur un Vault ouvert ;
- tente un `LoanSet` dans un Batch.

```bash
npm install xrpl@5.4.0-beta.0
```
```bash
node check-devnet.mjs                                     # devnet public
```
```bash
node check-devnet.mjs wss://<url-alphanet> <faucet-host>  # autre réseau
```

**Tester plusieurs URLs d'alphanet d'un coup** (Node 22, sans dépendance, compatible zsh) :

```bash
node -e 'const urls=["wss://alphanet.xrpl.org","wss://alphanet.xrpl.org:51233","wss://alphanet.nerdnest.xyz","wss://alphanet.nerdnest.xyz:51233"];const test=u=>new Promise(res=>{const t=setTimeout(()=>res(u+"  TIMEOUT"),8000);let ws;try{ws=new WebSocket(u)}catch(e){clearTimeout(t);return res(u+"  BAD "+e.message)}ws.onopen=()=>ws.send(JSON.stringify({command:"feature"}));ws.onmessage=m=>{clearTimeout(t);ws.close();const f=JSON.parse(m.data).result?.features;if(f===undefined)return res(u+"  REPLY "+String(m.data).slice(0,200));res(u+"  OK\n"+Object.values(f).filter(v=>/Lending|Vault|Confidential|Batch/.test(v.name)).map(v=>"   "+v.name.padEnd(24)+(v.enabled?"ENABLED":"off")).join("\n"))};ws.onerror=e=>{clearTimeout(t);res(u+"  ERR "+(e.message??e.type))}});(async()=>{for(const u of urls)console.log(await test(u));process.exit(0)})()'
```

**Points d'entrée utiles :**
- Devnet : `wss://s.devnet.rippletest.net:51233`, faucet `faucet.devnet.rippletest.net`
- App de référence Lending + Vault (Credentials, Domains, Vault, Lending, Batch déjà branchés) : `github.com/ripple/xrpl-reference-app-lending-sav`
- Tutos xrpl.org : *Issue an MPT for Confidential Transfers*, *Send Confidential MPT Payments*, *Create a Single Asset Vault*, *Deposit into a Vault*

---

## 19. Sources

- Hackathon : [hackathonradar](https://www.hackathonradar.com/database/hackathon/ixh26-italian-xrpl-hackathon-2026) · [XRPL Commons events](https://www.xrpl-commons.org/engage/events) · [Luma](https://luma.com/IXH26-xrpl-hackathon)
- CheckFi : [projet XRPL Commons](https://hackathons.xrpl-commons.org/projects/69dafc6412448cae7527966e)
- XLS-96 : [spec](https://xls.xrpl.org/xls/XLS-0096-confidential-mpt.html) · [ePrint 2026/602](https://eprint.iacr.org/2026/602) · [concepts xrpl.org](https://xrpl.org/docs/concepts/tokens/fungible-tokens/confidential-transfers) · [ConfidentialMPTSend](https://xrpl.org/docs/references/protocol/transactions/types/confidentialmptsend) · [tuto émission](https://xrpl.org/docs/tutorials/tokens/mpts/issue-mpt-for-confidential-transfers) · [tuto paiements](https://xrpl.org/es-es/docs/tutorials/payments/send-confidential-payments) · [XLS-99](https://xls.xrpl.org/xls/XLS-0099-confidential-mpt-key-rotation.html)
- XLS-65/66 : [XLS-66](https://github.com/XRPLF/XRPL-Standards/tree/master/XLS-0066-lending-protocol) · [Create a Vault](https://xrpl.org/docs/tutorials/defi/lending/use-single-asset-vaults/create-a-single-asset-vault) · [Deposit](https://xrpl.org/docs/tutorials/defi/lending/use-single-asset-vaults/deposit-into-a-vault) · [LoanManage](https://xrpl.org/docs/references/protocol/transactions/types/loanmanage) · [app de référence](https://github.com/ripple/xrpl-reference-app-lending-sav) · [PR rippled #8244 (lending en Batch)](https://github.com/XRPLF/rippled/pull/8244) · [LendingProtocolV1_2 (cryptodaily)](https://cryptodaily.co.uk/2026/10/xrpl-lendingprotocol-v1-2-two-step-loan-creation) · [CoinDesk 12 nov.](https://www.coindesk.com/tech/2026/11/12/ripple-s-bank-lending-system-moves-closer-to-launch-on-the-xrp-ledger)
- Statut des amendments : [xrpscan](https://xrpscan.com/amendments) · [xrpldashboard](https://xrpldashboard.com/amendments) · [XRPLWin](https://xrplwin.com/amendments) · [Permissioned Domains live](https://www.cryptopolitan.com/ripples-permissioned-domains-go-live-xrpl/)
- Alphanet : [article de Denis Angell](https://dev.to/dangell7/smart-contracts-on-xrpls-alphanet-1loo) · [repo réseau (privé)](https://github.com/XRPLF/xrplf-alphanet-network) · branche `alphanet` de `XRPLF/rippled`
- Code source rippled lu directement : `XRPLF/rippled` (`develop` 81878aa, tag `3.4.1`, branche `alphanet` e94e578)
