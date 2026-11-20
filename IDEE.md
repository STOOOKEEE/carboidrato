# Bari — Le fonds de factures dont chaque actif porte sa preuve

IXH26 (Bari, 20–21 novembre 2026) · **Track 3 : Tokenisation on XRPL**
**Soumission : samedi 21/11 à 12:00** · Pitch à 12:30 : **3 min + 2 min de questions**
Juges de la track : Francesco Pierangeli (LUM University), Vera Radeva (XRPL Commons), Tushar Pardhe (XRPL Commons), Carlo Brunetta (ShunyaXifra)

**Critères de la track (slide 38) :**

| Critère | Ce qui est évalué |
|---|---|
| **Effectiveness** | la tokenisation au cœur, l'usage du ledger, la proximité d'un vrai déploiement |
| **Crypto Vision** | comment la cryptographie donne une valeur vérifiable au token : nouveauté contre faisabilité |
| **The Pitch** | clarté, vision business, défense |

Ce document présente l'idée, l'architecture retenue et la stratégie pour gagner. Les annexes rassemblent le comparatif avec l'existant, la confidentialité, les pièges du circuit, les tentatives de fraude, le modèle de menace, le droit italien et les sources.

---

## Sommaire

1. [Le pitch](#1-le-pitch)
2. [Le problème](#2-le-problème)
3. [Le token au centre](#3-le-token-au-centre)
4. [Deux couches : le certificat et le financement](#4-deux-couches--le-certificat-et-le-financement)
5. [Le parcours de Marco](#5-le-parcours-de-marco)
6. [L'atomicité : ce qu'XRPL permet aujourd'hui](#6-latomicité--ce-quxrpl-permet-aujourdhui)
7. [La cryptographie](#7-la-cryptographie)
8. [Option : Phala, une enclave attestée](#8-option--phala-une-enclave-attestée)
9. [Périmètre pour samedi 12:00](#9-périmètre-pour-samedi-1200)
10. [Le pitch de 3 minutes](#10-le-pitch-de-3-minutes)
11. [Questions du jury : réponses prêtes](#11-questions-du-jury--réponses-prêtes)
12. [Ce que chaque juge doit retenir](#12-ce-que-chaque-juge-doit-retenir)
13. [Feuille de route](#13-feuille-de-route)
14. [Règles et logistique](#14-règles-et-logistique)

**Annexes**

- [A. Bari face à l'existant](#annexe-a--bari-face-à-lexistant)
- [B. Qui voit quoi](#annexe-b--qui-voit-quoi)
- [C. Les pièges du circuit](#annexe-c--les-pièges-du-circuit)
- [D. Les tentatives de fraude et ce qui les bloque](#annexe-d--les-tentatives-de-fraude-et-ce-qui-les-bloque)
- [E. Modèle de menace](#annexe-e--modèle-de-menace)
- [F. Droit italien](#annexe-f--droit-italien)
- [G. Sources](#annexe-g--sources)

---

## 1. Le pitch

**Phrase d'ouverture**
> « Dans votre exemple, le rendement du token n'est crédible qu'à l'étape 3, la vérification. Bari, c'est l'étape 3 pour les 4 000 milliards d'euros de factures. »

**En une phrase**
> Un token ne vaut que ses données. Le token Bari est une part d'un fonds de factures de PME. Sa valeur est crédible parce que chaque facture du fonds est elle-même un token qui porte sa preuve cryptographique : attestée par le débiteur, unique, suffisante, vérifiable par tous, sans révéler ni la facture ni le client.

**L'angle XRPL**
> Le Lending Protocol d'XRPL (XLS-66) prête « sans garantie », sur la base d'un underwriting hors chaîne et opaque. C'est cette opacité qui a coûté des milliards aux prêteurs de First Brands. Bari rend cet underwriting vérifiable, sans le divulguer.

---

## 2. Le problème

- **Les PME attendent des mois pour être payées.** En Italie, c'est structurel du côté de l'administration publique : la Cour de justice de l'UE a condamné l'Italie en 2020 (affaire C-122/18), et la Commission l'a de nouveau renvoyée devant la Cour en novembre 2023.
- **Le financement de factures dépasse 4 000 Md€ par an** (FCI, 2025), mais il bute sur un dilemme : pour vérifier qu'une facture est vraie et qu'elle n'a pas déjà été financée, le financeur doit la voir, et donc voir les clients de la PME.
- **La fraude prospère dans cet angle mort.** Chez First Brands (2025), des factures ont pu être financées plusieurs fois ; selon un créancier, 2,3 milliards de dollars ont « simplement disparu ».
- **L'existant prouve le besoin sans résoudre le dilemme.**
  - MonetaGo bloque les doublons depuis 2018 (6 millions de transactions), mais avec un registre central, un opérateur qui voit les données et des enclaves sécurisées chez Google Cloud.
  - La PCC de l'État italien certifie les créances publiques, au prix d'actes notariés.
  - Les blockchains de consortium bancaires (we.trade, Marco Polo, Contour) sont toutes mortes.

---

## 3. Le token au centre

Le critère *Effectiveness* exige « tokenization at the core ». Le risque à éviter : que les juges voient « une appli de prêt avec un token à côté ».

**Il y a deux niveaux de tokens, et le second rend le premier crédible.**

| Token | Détenteur | Ce qu'il représente | Ce qui le rend crédible |
|---|---|---|---|
| **Part du fonds** (le MPT émis par le vault) | les investisseurs | une quote-part du fonds de factures et de son rendement | chaque actif sous-jacent est vérifiable |
| **Facture** (un MPT en un seul exemplaire) | Bari, pendant le prêt | une facture attestée par son débiteur | **la preuve, inscrite dans ses métadonnées** |

**Correspondance avec l'exemple des organisateurs (slides 32-33) :**

| Exemple « énergie » | Bari |
|---|---|
| **Fund** : les investisseurs achètent des tokens | les investisseurs souscrivent des parts du vault |
| **Produce** : la centrale produit et vend son énergie | la PME livre et facture la mairie |
| **Verify** : les compteurs signent les données, les preuves sont ancrées sur le ledger | **la mairie signe l'attestation** (c'est elle, le compteur) ; la preuve ZK et l'empreinte sont ancrées sur XRPL |
| **Return** : le revenu revient aux porteurs, au prorata | le remboursement du prêt augmente la valeur des parts, au prorata |

Les trois « ingrédients » cryptographiques cités par les organisateurs sont exactement les nôtres :
- des **mesures signées** : l'attestation du débiteur ;
- des **engagements et arbres de Merkle** : l'engagement `C` et la liste des débiteurs vérifiés ;
- des **preuves privées** : la preuve ZK.

**Pendant la démo, ouvrir l'explorer sur le MPT facture et montrer la preuve dans ses métadonnées.** C'est le moment où le jury *voit* le token porter sa preuve.

---

## 4. Deux couches : le certificat et le financement

*Closeness to real deployment* est un critère, et `LendingProtocolV1_1` est à **0 %** des votes sur mainnet. Le produit est donc séparé en deux couches.

**Couche 1 : le certificat. C'est le produit, et il fonctionne sur mainnet dès aujourd'hui.** Il comprend l'attestation du débiteur, la preuve ZK, l'empreinte enregistrée et le MPT facture. Il n'utilise que des briques déjà actives sur mainnet : MPT, Credentials, `Batch`.

**Couche 2 : le financement, interchangeable.**

| | Modèle A : vente directe | Modèle B : fonds de prêt (notre démo) |
|---|---|---|
| Principe | les investisseurs achètent des fractions du token facture | les investisseurs déposent dans un vault ; Bari prête aux PME via le Lending Protocol |
| Briques | MPT, Credentials, `Batch` | + Single Asset Vault (XLS-65) + Lending Protocol (XLS-66) |
| Atomicité | **totale** : certificat, token et paiement dans un seul `Batch` | partielle (voir §6) |
| Mainnet | **actif aujourd'hui** | à l'activation : `SingleAssetVault` 45,71 %, `LendingProtocol` 37,14 %, `LendingProtocolV1_1` 0 % |

**La réponse au jury :** « Le certificat fonctionne sur mainnet dès aujourd'hui, avec la vente directe des tokens (modèle A). Il se branche sur XLS-66 dès son activation (modèle B, celui de notre démo). »

**Le modèle B a été testé sur devnet** (test de faisabilité, code non conservé) : vault privé et fermé, broker, mise en première perte, prêt co-signé, remboursement.

| Pour une facture de 10 000 € à 90 jours | Montant |
|---|---|
| Avance reçue par la PME (90 % moins 45 € de frais) | 8 955 € |
| Coût total pour la PME | 178,16 € |
| Rendement des investisseurs | ≈ 5,9 % par an |
| Revenu de Bari par prêt | 46,33 € |

Le vault est **fermé**, c'est-à-dire millésimé : les investisseurs souscrivent pendant une fenêtre, le fonds prête pendant sa durée de vie, puis rend le capital et les intérêts. La règle imposée par le protocole : **la mise de Bari doit couvrir 10 % de l'encours**.

**La liquidité des investisseurs.** Le fonds est fermé, mais les parts sont des MPT transférables entre comptes KYC. Un investisseur peut donc céder ses parts de gré à gré, avec un règlement atomique via `Batch` : un `Payment` en parts contre un `Payment` en euros, deux transactions autorisées dans un `Batch`, y compris sur devnet. Le marché secondaire sur DEX viendra avec XLS-82.

**Le modèle économique**

| Acteur | Ce qu'il paie | Ce qu'il gagne |
|---|---|---|
| La PME | les frais de dossier (0,5 % de l'avance) et les intérêts : 178,16 € pour 8 955 € pendant 90 jours, soit environ 8,1 % par an | du cash tout de suite, sans exposer ses clients |
| Les investisseurs | la part des intérêts qui revient à Bari | environ 5,9 % par an, sur des créances publiques vérifiées |
| Bari | sa mise en première perte (10 % de l'encours) | les frais de dossier + 1 % des intérêts (le protocole autorise jusqu'à 10 %) |
| Le débiteur | rien : c'est la condition de son adoption | des fournisseurs qui tiennent le coup, sans payer plus tôt |

Taille du marché : plus de 4 000 Md€ de factures financées par an dans le monde (FCI, 2025). Le chiffre du marché italien (rapport Assifact) est à vérifier avant de le citer.

---

## 5. Le parcours de Marco

1. **La mairie atteste la facture**, une seule fois. Elle calcule un `uuid` par HMAC à partir du numéro officiel de la facture, puis signe le message avec sa clé EdDSA.
2. **Marco calcule la preuve dans son navigateur.** La facture n'en sort jamais.
3. **Le certificat est créé**, toujours dans cet ordre :
   - l'empreinte est enregistrée (`CredentialCreate` avec type = `N`) ; si elle existe déjà, tout s'arrête là ;
   - le token facture est créé, avec la preuve dans ses métadonnées ;
   - ce token est remis à Bari.

   Dans la version finale, ces trois opérations sont regroupées dans un `Batch` atomique, signé par Marco et Bari (voir §6).
4. **Bari vérifie la preuve, l'unicité et la concentration** (pseudonyme `P`), puis propose le prêt. Marco contre-signe et reçoit 8 955 €. Le champ `Data` du `LoanSet` contient `N`, l'identifiant du token facture et `P`.
5. **N'importe quel investisseur peut auditer le fonds :** toutes les preuves, l'unicité des empreintes, la concentration par débiteur, sans voir une seule facture.
6. **À l'échéance**, la mairie paie Marco, Marco rembourse, et la valeur des parts monte.

---

## 6. L'atomicité : ce qu'XRPL permet aujourd'hui

**`Batch` est actif**, sur devnet comme sur mainnet (`BatchV1_1`, `fixBatchV1_2`). Le `Batch` d'origine a été retiré en 3.1.1 à cause d'un bug critique. Mais pour l'instant, **les transactions de prêt et de vault ne peuvent pas entrer dans un `Batch`** (erreur `temINVALID_INNER_BATCH`).

| Dans un `Batch` | Possible ? |
|---|---|
| `CredentialCreate`, `MPTokenIssuanceCreate`, `MPTokenAuthorize`, `Payment` en MPT | **oui** |
| `LoanSet`, `LoanPay`, `LoanManage`, `LoanDelete`, tous les `LoanBroker*` | non |
| `VaultCreate`, `VaultDeposit`, `VaultWithdraw`, tous les `Vault*` | non |

La doc parle de transactions *« currently-disabled »*, et celle de `LoanSet` prévoit déjà le cas où il est inclus dans un `Batch`. C'est donc temporaire, pas exclu par conception.

**Conséquences pour le modèle B :**
1. **Le certificat est atomique.** Un seul `Batch` signé par Marco et Bari (`tfAllOrNothing`) regroupe l'enregistrement de l'empreinte, la création du token facture, l'inscription de Bari au token et le transfert du token. L'identifiant du token se calcule à l'avance, puisqu'il est formé du numéro de séquence et du compte émetteur.
2. **Le prêt suit, dans une transaction séparée.** Le `LoanSet` reste atomique en lui-même : la création du prêt et le versement des fonds se font dans la même transaction. Bari vérifie la liquidité et sa mise de première perte **avant** le certificat, si bien qu'un échec ici est improbable.
3. **L'ordre est impératif : enregistrer d'abord, prêter ensuite.** Dans l'autre sens, la même facture pourrait être financée ailleurs dans la fenêtre qui sépare les deux opérations.
4. **Si le prêt échoue**, la facture reste « enregistrée, en attente de financement par Bari », et Bari relance le prêt. On ne supprime jamais un enregistrement : une suppression serait visible dans l'historique, comme un signal de fraude.

**La règle :** une facture est financée **si et seulement si un prêt la référence** (champ `Data`). L'enregistrement par credential sert de verrou contre les tentatives concurrentes.

Le jour où `LoanSet` sera autorisé dans un `Batch`, le certificat et le prêt deviendront un seul bloc atomique, sans rien changer d'autre à l'architecture.

---

## 7. La cryptographie

### 7.1 Deux couches de cryptographie

**Celle qu'XRPL fournit, et qu'on exploite :**
- les signatures de transactions (secp256k1 ou Ed25519) ;
- la double signature du `LoanSet`, qui exprime le consentement mutuel ;
- les signatures multi-comptes d'un `Batch` (`BatchSigners`) ;
- les **identifiants d'objets déterministes** : l'identifiant d'un `Credential` est un hachage du trio (sujet, émetteur, type). Deux créations avec `type = N` tombent sur le même identifiant, et le ledger refuse la seconde (`tecDUPLICATE`).

**Celle de Bari :** elle prouve qu'une facture est authentique, unique, suffisante et diversifiée, sans la montrer.

### 7.2 Les primitives et leur rôle

| Primitive | Rôle | Calculée par | Où elle vit |
|---|---|---|---|
| **HMAC-SHA256** | `uuid` de facture déterministe et indevinable | le débiteur | dans l'attestation |
| **Poseidon** | hachage adapté aux circuits : message, engagement, empreinte, pseudonyme, arbre | la PME, dans le circuit | dans la preuve |
| **EdDSA sur BabyJubJub** | signature du débiteur : l'authenticité à la source | le débiteur | dans l'attestation, vérifiée dans le circuit |
| **Arbre de Merkle** | « débiteur vérifié », sans dire lequel | Bari publie la racine, la PME prouve | racine on-chain |
| **Engagement** `C` | lie la preuve à une facture précise, que l'on peut révéler en cas de litige | la PME | métadonnées du token |
| **Empreinte** `N` | anti-double financement | la PME, imposée par le circuit | `CredentialType`, `Data` du prêt |
| **Pseudonyme** `P` | diversification vérifiable : même débiteur, même pseudonyme, au sein d'un millésime | la PME, imposé par le circuit | métadonnées du token, `Data` du prêt |
| **Preuve d'intervalle** | montant ≥ seuil, sans révéler le montant | dans le circuit | — |
| **Groth16** | prouve tout l'énoncé en 256 octets | la PME, dans son navigateur | métadonnées du token |

**Pourquoi ces choix :**
- **Poseidon** coûte environ 250 contraintes, contre environ 30 000 par bloc SHA-256.
- **BabyJubJub** est définie sur le corps même du circuit : vérifier une signature y coûte quelques milliers de contraintes, contre environ 1,5 million pour une ECDSA secp256k1. Le débiteur a donc une clé d'attestation dédiée.
- **Groth16** produit la preuve la plus petite (256 octets, qui tient dans les 1024 octets de métadonnées du token) et la vérification la plus rapide (ce qui permet un audit instantané de tout le fonds).

### 7.3 L'énoncé prouvé

```
Données privées : montant, uuid, clé publique du débiteur, signature du débiteur,
                  chemin Merkle, aléa r
Données publiques : racine de la liste des débiteurs, compte XRPL de Marco, seuil,
                    échéance, networkId, registre, millésime du fonds

Le circuit vérifie :
  1. m = Poseidon(compte de Marco, clé du débiteur, montant, échéance, uuid, networkId, registre)
  2. la signature EdDSA du débiteur sur m est valide
  3. Poseidon(clé du débiteur) appartient à l'arbre dont la racine est publique
  4. montant ≥ seuil, avec une décomposition en 64 bits avant la comparaison
  5. sorties publiques :
       C = Poseidon(m, r)                                    l'engagement
       N = Poseidon(DOMAINE_N, uuid)                         l'empreinte anti-doublon
       P = Poseidon(DOMAINE_P, clé du débiteur, millésime)   le pseudonyme du débiteur
```

Ordres de grandeur estimés :
- environ 10 000 contraintes, soit une preuve calculée en quelques secondes dans un navigateur ;
- environ 800 octets de métadonnées avec un encodage compact.

**Pourquoi chaque donnée publique existe :**
- **compte de Marco :** lier la preuve à son propriétaire, contre le vol de preuve ;
- **`networkId` et registre :** empêcher le rejeu sur une autre chaîne ;
- **racine :** désigner la liste, et donc le niveau de risque, du débiteur ;
- **seuil et échéance :** garantir que le prêt correspond à la facture ;
- **millésime :** délimiter la portée du pseudonyme.

### 7.4 Ce que chaque primitive garantit à l'investisseur

C'est la réponse au critère *Crypto Vision* : chaque brique couvre un risque précis, qui fait la valeur du token.

| Ce que craint l'investisseur | Propriété garantie | Primitive |
|---|---|---|
| la facture n'existe pas | authenticité à la source | signature EdDSA du débiteur |
| le débiteur est une société écran | appartenance à une liste vérifiée | arbre de Merkle |
| la facture est financée deux fois | unicité | empreinte `N` + `tecDUPLICATE` |
| la facture ne couvre pas le prêt | suffisance | preuve d'intervalle |
| tout le fonds repose sur un seul débiteur | diversification vérifiable | pseudonyme `P` |
| en cas de litige, rien n'est récupérable | redevabilité | engagement `C` (et le chiffrement pour l'auditeur, en option) |
| la PME expose ses clients | confidentialité | *zero-knowledge* |

### 7.5 Trois idées propres à Bari

**On assume que les briques sont standards** : c'est la composition de Semaphore (signature, arbre de Merkle, nullifier, Groth16). Ce qui est propre à Bari, c'est l'usage qui en est fait.

**1. L'empreinte déterministe fixée par le débiteur.**

```
uuid = HMAC(secret du débiteur, n° officiel de la facture)
N    = Poseidon(DOMAINE_N, uuid)
```

- **Même facture, même empreinte**, même si le débiteur l'atteste deux fois. À l'inverse, un aléa choisi par la PME donnerait une empreinte différente à chaque tentative, et l'anti-doublon ne servirait à rien.
- **L'empreinte est indevinable sans le secret du débiteur** : personne ne peut tester par force brute quelles factures d'une PME sont financées.
- **Le débiteur devient l'arbitre de l'unicité, y compris d'une chaîne à l'autre, sans pont.** Le message signé contient `networkId` et le registre : l'attestation est inutilisable ailleurs, sur le principe d'EIP-155 pour Ethereum. Exemple : Xahau utilise les mêmes comptes et les mêmes clés qu'XRPL, mais `2 ≠ 21337`.

**2. Un registre de nullifiers imposé par le ledger, sans smart contract.**

```
CredentialCreate(Subject = registre Bari, Issuer = la PME, CredentialType = N)
→ 1re fois : tesSUCCESS        → 2e fois : tecDUPLICATE, refusé par le ledger
```

L'unicité est garantie **par le protocole lui-même**, sans code maison.

**3. Une diversification vérifiable, sans connaître le débiteur.**

```
P = Poseidon(DOMAINE_P, clé du débiteur, millésime du fonds)
```

- Deux prêts sur le même débiteur, dans le même millésime, portent **le même pseudonyme**. Bari plafonne donc l'exposition **par débiteur** (par exemple 20 % du fonds), et chaque investisseur le vérifie, **sans que personne ne sache qui est ce débiteur**.
- D'un millésime à l'autre, les pseudonymes ne sont plus reliables.
- C'est l'anonymat « à portée limitée » de Semaphore et de RLN, appliqué au risque de crédit.
- Ça transforme la principale objection financière (la concentration) en propriété cryptographique.

**Le prix du risque, sans connaître le débiteur.** Bari publie une liste de Merkle **par niveau de risque** (État, collectivités locales, grands comptes notés…), donc une racine par niveau. La preuve révèle le niveau du débiteur, jamais son identité, et le taux du prêt dépend de ce niveau. Les deux mécanismes se complètent : le niveau fixe le prix, le pseudonyme `P` limite la concentration. Le prix à payer : chaque liste est plus petite, donc l'anonymat de chaque débiteur aussi.

### 7.6 Option : un chiffrement vérifiable pour un auditeur

« Confidentiel pour le public, auditable par le régulateur. »

1. La PME chiffre les champs de la facture pour la clé publique d'un auditeur désigné : un échange de clés ECDH sur BabyJubJub, puis un chiffrement par Poseidon.
2. Le circuit prouve que **le chiffré contient exactement la facture prouvée**.
3. Le chiffré est stocké hors ledger ; son hachage devient une sortie publique de la preuve.

Points à retenir :
- C'est **le modèle d'XLS-96**, qui prévoit une clé d'auditeur : on reste dans la direction prise par XRPL.
- Les briques existent déjà en circom : c'est ce qu'utilise MACI.
- Coût estimé : 4 à 6 heures. À faire uniquement si le circuit de base tourne vers 23:00.

### 7.7 Limites assumées

À dire avant qu'on nous les oppose.

- **XRPL ne vérifie pas la preuve.** Tout le monde la vérifie côté client ; le ledger, lui, garantit l'unicité.
- **Trusted setup.** On fait une cérémonie à plusieurs contributeurs, terminée par un *beacon* public. Il suffit qu'un seul contributeur soit honnête.
- **Post-quantique.** Groth16 ne l'est pas : la confidentialité des preuves tiendrait, la solidité non. Nos hachages, eux, résistent. Migration possible vers les STARK.
- **Niveau de sécurité.** BN254 offre environ 100 bits de sécurité ; en production, on passerait sur BLS12-381.
- **Anonymat du débiteur.** Il vaut la taille de la liste : avec 3 débiteurs, la preuve n'en cache que 3.
- **Confiance dans le débiteur.** L'unicité suppose qu'il calcule honnêtement son HMAC ; une VRF lèverait cette hypothèse (feuille de route).
- **Liaison volontaire.** Le pseudonyme `P` relie les prêts d'un même débiteur au sein d'un millésime : c'est le prix de la diversification vérifiable.
- **Ce qui reste public :** le montant des prêts, leurs dates et le compte de la PME.

### 7.8 Ce qu'on ne fait pas

- **Pas de FHE, de MPC ni de signatures post-quantiques « pour impressionner ».** Selon le dossier, Brunetta pense que les LLM sont des *« translators, not engineers »* : toute brique sans justification nous coûte des points.
- **On ne sacrifie pas la démo.** Dans cette track, un seul juré sur quatre est cryptographe.

---

## 8. Option : Phala, une enclave attestée

**Statut : en option, hors du périmètre de base.** À n'envisager que si tout le périmètre obligatoire est terminé. Plus réalistement, c'est une ligne de la feuille de route.

### Le principe

Phala Cloud fait tourner un conteneur dans une enclave matérielle Intel TDX, avec une **attestation à distance** qui permet de vérifier quel code y tourne. On y placerait trois contrôles : le vérificateur ZK, le contrôle du registre et la vérification KYB.

L'enclave détiendrait deux clés : la clé de co-signature du `LoanSet` côté broker, et la clé émettrice des credentials du registre. La vérification deviendrait alors « hors chaîne, mais attestée ».

### Ce que ça apporte

- **Un contrôle avant, plutôt qu'un audit après.** La clé du broker est incapable de signer un prêt sans preuve valide.
- **Une unicité globale.** L'enclave étant l'émettrice unique des credentials, le trio (registre, enclave, `N`) est unique sur tout le réseau, et plus seulement par PME.
- **Un traitement confidentiel des documents KYB**, que la ZK ne couvre pas facilement.

### Ce que ça coûte

- **La confiance repose sur le matériel Intel, pas sur les maths.** C'est à contre-courant de la thèse de la track : *« cryptographic proofs that bind the token to real value »*.
- **Ça rapproche Bari de MonetaGo**, dont la confidentialité repose justement sur des enclaves chez Google Cloud. C'était notre principal point de différence.
- **La garantie est fragile.** [TEE.fail](https://tee.fail/) (octobre 2025, IEEE S&P 2026) extrait les clés d'attestation d'Intel via un interposeur sur le bus mémoire DDR5 et casse l'attestation de SGX et de TDX. Intel a publié un avis de sécurité.
- **Une dépendance de plus sur le chemin critique** : compte Phala, dérivation d'une clé XRPL dans l'enclave, vérification de l'attestation pendant la démo.
- **Une question piège en Q&A** : « si vous faites confiance à l'enclave, pourquoi la ZK ? »

### La bonne façon de l'utiliser

**Jamais comme racine de confiance, toujours comme un signataire parmi d'autres.** La clé du broker devient une `SignerList` XRPL **k-sur-n** : Bari, un auditeur, un représentant des investisseurs, et éventuellement l'enclave. Chaque signataire fait tourner le vérificateur open source avant de signer, et c'est le ledger qui exige le quorum.

Ainsi, ni Bari, ni Intel, ni aucun signataire seul ne peut accorder un prêt. Le `LoanSet` accepte un compte broker multi-signé, et le multisig est natif d'XRPL : il fonctionne même sans enclave.

---

## 9. Périmètre pour samedi 12:00

Une démo crédible bat quatre écrans à moitié faits.

| Priorité | Livrable | Fait quand |
|---|---|---|
| **1** | **le circuit de base + le pseudonyme `P`** | une preuve est générée puis vérifiée ; les tests négatifs échouent (montant modifié, mauvais `networkId`, débiteur hors liste) ; deux factures du même débiteur donnent le même `P` |
| **2** | **le certificat, dans l'ordre** | l'empreinte est enregistrée, puis le token facture avec sa preuve est créé et transféré à Bari ; un second enregistrement est refusé (`tecDUPLICATE`) |
| **3** | **la démo de bout en bout** | attestation → preuve → certificat → prêt (avec `Data` = `N`, ID du token, `P`) → refinancement refusé → audit (preuves, unicité, concentration) → remboursement, sur devnet |
| **4** | **le front minimal** | les écrans strictement nécessaires pour dérouler la démo |
| option | chiffrement vérifiable pour l'auditeur (§7.6) | seulement si 1 à 3 sont faits vers 23:00 |
| option | Phala, ou multisig k-sur-n du broker (§8) | seulement si tout le reste est fini ; sinon, feuille de route |
| option | regrouper le certificat dans un `Batch` atomique | à la fin, si le temps le permet : pour la démo, respecter l'ordre suffit |

- **Réseau :** tout se construit et se démontre sur devnet, qui a tous les amendements nécessaires (vérifié le 20/11 à 17:01 : `BatchV1_1`, `SingleAssetVault`, `LendingProtocol`, `LendingProtocolV1_1`, `Credentials`, `MPTokensV1`).
- **Déjà validé :** la faisabilité du cycle de prêt sur devnet (couche 2, modèle B), lors d'un test. Le code est à écrire pendant le build.
- **Hors périmètre :** l'implémentation du modèle A, XLS-96, la VRF, le branchement SdI/PCC, la migration post-quantique. Tout cela va dans la feuille de route.
- **Gel du code vers 10:00.** Il faut ensuite deux heures pour le texte de soumission, les slides, la déclaration IA et la répétition.

---

## 10. Le pitch de 3 minutes

| Temps | Contenu |
|---|---|
| 0:00 – 0:20 | la phrase d'ouverture sur l'étape 3 |
| 0:20 – 0:50 | Marco, la mairie, 90 jours d'attente ; First Brands ; le dilemme « vérifier sans exposer » |
| 0:50 – 2:15 | **démo** : attestation → preuve dans le navigateur → certificat (empreinte enregistrée) → **le token facture et sa preuve dans l'explorer** → prêt → **refinancement refusé** → audit du fonds (preuves, unicité, concentration) |
| 2:15 – 2:45 | **Crypto Vision** : le tableau « risque de l'investisseur → primitive » et les trois idées propres à Bari |
| 2:45 – 3:00 | les deux couches (mainnet aujourd'hui, XLS-66 demain) ; les administrations italiennes, le SdI et la PCC comme point d'entrée |

---

## 11. Questions du jury : réponses prêtes

| Question probable | Réponse |
|---|---|
| « Qui vérifie la preuve, puisque XRPL ne le peut pas ? » | « Tout le monde, côté client, et l'audit du fonds le fait pour chaque prêt. L'unicité, elle, est garantie par le ledger (`tecDUPLICATE`). » |
| « La PME peut-elle changer un champ pour obtenir une autre empreinte ? » | « Non : l'empreinte dérive de l'`uuid` signé par le débiteur. Toute modification casse la signature. » |
| « Et si le débiteur est complice ? » | « Son attestation l'engage à payer, et seuls des débiteurs vérifiés sont dans la liste. Une VRF rendrait même l'empreinte vérifiablement unique (feuille de route). » |
| « Et le risque de concentration, si personne ne sait qui est le débiteur ? » | « Chaque preuve publie un pseudonyme du débiteur, propre au millésime. Bari plafonne l'exposition par pseudonyme, et tout investisseur le vérifie, sans connaître le débiteur. » |
| « Quel est le cadre réglementaire ? » | « Les parts du vault relèvent vraisemblablement des instruments financiers (des parts de fonds) : en production, Bari opérerait dans le cadre régulé correspondant, que nous ferons valider par un juriste. » *(À vérifier, nous ne sommes pas juristes.)* |
| « Les prêts de la PME sont publics : où est la confidentialité de l'emprunteur ? » | « Aujourd'hui, le compte et les prêts sont visibles. La feuille de route prévoit des adresses à usage unique par prêt, ou XLS-96 pour chiffrer les soldes. » |
| « Pourquoi le prêt n'est-il pas atomique avec le certificat ? » | « Parce que XRPL n'autorise pas encore les transactions de prêt dans un `Batch`. Le certificat est atomique, on enregistre toujours avant de prêter, et le jour où `LoanSet` sera autorisé dans un `Batch`, tout tiendra en un seul bloc. » |
| « Pourquoi pas une enclave (TEE) ? » | « Parce que la confiance doit venir des maths : TEE.fail a montré en 2025 qu'une attestation Intel peut être forgée avec un accès physique. Une enclave peut être un signataire parmi d'autres dans un multisig, jamais la racine. » |
| « Qui a fait le trusted setup ? » | « Une cérémonie à plusieurs contributeurs, terminée par un beacon public. Il suffit qu'un seul soit honnête. » |
| « C'est post-quantique ? » | « Groth16 non : la confidentialité tiendrait, la solidité non. Nos hachages oui. La migration vers les STARK est prévue. » |
| « MonetaGo fait déjà ça. » | « Oui, et ça prouve le besoin : 6 millions de transactions depuis 2018. Mais MonetaGo repose sur un opérateur et des enclaves qui voient les données. Chez Bari, l'empreinte est signée par le débiteur et vérifiable par tous. » |
| « Pourquoi XRPL et pas Ethereum ? » | « Sur Ethereum, un contrat vérifierait la preuve on-chain, mais il faudrait écrire et auditer nous-mêmes le vault, les prêts, le KYC et l'unicité. Sur XRPL, tout cela est natif et audité avec le protocole. Le compromis : la preuve est vérifiée côté client, ce que compensent l'audit public et l'unicité imposée par le ledger. » |
| « Juridiquement, le token vaut-il la créance ? » | « Non, et on ne le prétend pas : en droit italien, la priorité dépend de la notification au débiteur (art. 1265 du Code civil). Dans notre modèle, c'est un prêt adossé à la facture ; le token est une preuve et une entrée de registre. » |
| « Comment fixez-vous le taux sans connaître le débiteur ? » | « Une liste par niveau de risque : la preuve révèle le niveau, jamais l'identité, et le taux dépend du niveau. Le pseudonyme du débiteur gère la concentration. » |
| « Les investisseurs sont-ils bloqués un an dans le fonds fermé ? » | « Non : les parts sont des MPT transférables entre comptes KYC, cessibles de gré à gré avec un règlement atomique via `Batch`. Le marché secondaire sur DEX viendra avec XLS-82. » |

---

## 12. Ce que chaque juge doit retenir

| Juge | Ce qu'on lui montre |
|---|---|
| **Pierangeli** (finance, RWA, régulation, quantique) | un fonds fermé avec une tranche de première perte ; l'économie de chaque acteur ; **la concentration rendue vérifiable par le pseudonyme** ; le cadre réglementaire visé ; une réponse honnête sur le post-quantique |
| **Radeva** (impact, XRPL comme outil) | Marco et les retards de paiement publics en Italie ; la transparence sur l'existant (MonetaGo, PCC) ; la viabilité à 12 mois |
| **Pardhe** (XRPL natif, XLS-66, confidentialité) | vault, broker, première perte et credentials bien utilisés (dont le vault fermé imposé par V1_1) ; `tecDUPLICATE` détourné en registre ; `Batch` pour l'atomicité du certificat et sa limite actuelle ; le multisig natif plutôt qu'une enclave ; la confidentialité de l'emprunteur en feuille de route |
| **Brunetta** (ZK ancrée sur XRPL) | preuve hors chaîne et vérification bon marché ; chaque propriété justifiée par un risque de l'investisseur ; trois usages propres à Bari ; les pièges évités et les limites assumées ; un artefact qui tourne |

---

## 13. Feuille de route

| Élément | Ce qu'il apporte |
|---|---|
| `LoanSet` autorisé dans un `Batch` | le certificat et le prêt en un seul bloc atomique |
| Empreinte par VRF (type PLUME) | une unicité vérifiable, même face à un débiteur malhonnête |
| Chiffrement vérifiable pour l'auditeur (si non fait au hackathon) | confidentiel pour le public, auditable par le régulateur |
| Multisig k-sur-n du broker, avec une enclave en option | plus aucune racine de confiance unique |
| Branchement sur le SdI et la PCC | réutiliser les attestations qui existent déjà dans l'administration italienne (formats de signature à vérifier) |
| Version notifiée (structure de recouvrement) | le débiteur paie une structure qui rembourse le prêt : plus de risque de détournement |
| XLS-96 | chiffrer les soldes et les avoirs |
| XLS-82 | un marché secondaire des parts et des factures |
| BLS12-381, puis STARK | une sécurité renforcée, puis post-quantique et sans trusted setup |
| Vérification de la preuve on-chain, par un contrat WASM (XLS-101) | le ledger vérifie lui-même la preuve ; testable sur AlphaNet, le réseau de développement des smart contracts XRPL |
| Mainnet | dès l'activation de `SingleAssetVault`, `LendingProtocol` et `LendingProtocolV1_1` |

---

## 14. Règles et logistique

- **Déclaration IA obligatoire** (slide 37) : quel outil, comment, où, pour la conception, le code, la documentation et la préparation du pitch.

  État actuel : Claude (Anthropic), utilisé via un agent de code, pour :
  - l'exploration de l'architecture et de la construction cryptographique ;
  - la documentation (`IDEE.md`) ;
  - la préparation du pitch (structure, réponses aux questions).

  À mettre à jour avec le circuit, le front et les slides avant la soumission.
- **Hack the Mentor aujourd'hui à 17:00 :** présenter l'idée à Brunetta et Tushar, qui sont mentors **et** juges de la track.
- **Choisir la track 3 dans l'application** : un seul projet par équipe, dans une seule track.
- **Ne jamais partager** de seed, de clé privée ni de transaction signée (règle *Safe help* des organisateurs).

---

## Annexe A — Bari face à l'existant

| | Droit (art. 1265) | MonetaGo | PCC | Bari |
|---|---|---|---|---|
| Prévient ou répare ? | répare | prévient | prévient | prévient |
| Qui fixe l'empreinte | — | le prêteur, à partir des documents de l'emprunteur | l'administration, qui certifie | le débiteur, qui signe |
| Facture inventée | découverte au défaut | hors périmètre (ne détecte que les doublons) | bloquée | bloquée |
| Champ modifié pour tromper | — | détection floue, probabiliste | — | impossible (la signature casse) |
| Confidentialité | — | opérateur + enclaves | l'administration | preuve ZK, aucun opérateur |
| Qui peut vérifier | un juge, après coup | les membres du réseau | les banques habilitées | tout le monde |

**Le besoin est prouvé par l'existant.** Ce que Bari apporte, c'est un registre **public**, sans **opérateur de confiance**, dont l'empreinte est **signée par le débiteur** et dont la confidentialité est **mathématique**.

---

## Annexe B — Qui voit quoi

| Information | Public (n'importe qui) | Bari | Investisseurs | Mairie |
|---|---|---|---|---|
| Compte XRPL de la PME | oui | oui | oui | oui |
| Identité légale de la PME | non | oui (relation contractuelle) | non | oui |
| Montant de l'avance, dates du prêt | oui | oui | oui | — |
| « La facture vaut au moins X » | oui | oui | oui | — |
| Pseudonyme `P` du débiteur (relie ses prêts au sein d'un millésime) | oui | oui | oui | oui (elle peut le recalculer) |
| Montant exact de la facture | **non** | **non** | **non** | oui |
| Identité du débiteur | **non** | **non** | **non** | oui |
| Contenu de la facture | **non** | **non** | **non** | oui |
| Quelles factures de la mairie sont financées | **non** | **non** | **non** | oui (elle sait recalculer ses empreintes) |

Avec l'option du chiffrement vérifiable (§7.6), un auditeur désigné peut en plus déchiffrer le contenu des factures. Personne d'autre ne le peut.

---

## Annexe C — Les pièges du circuit

À relire avant de coder le circuit et le vérificateur.

| Piège | Ce qui se passerait | Parade |
|---|---|---|
| Aléa choisi par le prouveur dans l'empreinte | une nouvelle empreinte à chaque tentative : l'anti-doublon ne sert à rien | l'aléa va **uniquement** dans l'engagement `C`, jamais dans `N` |
| Empreinte dérivée de la signature | une signature peut exister sous plusieurs formes valides (malléabilité) ou être aléatoire : plusieurs empreintes pour une seule facture | `N` dérive de l'`uuid` attesté, pas de la signature |
| Empreinte calculée sur des données devinables | montant, date et débiteur ont peu d'entropie : on pourrait tester par force brute « telle PME a-t-elle financé telle facture ? » | `uuid` calculé par HMAC avec le secret du débiteur |
| Comparaisons sans contrôle de bornes | un prouveur malveillant exploite le débordement du corps fini et « prouve » n'importe quel montant | décomposition en bits (`Num2Bits`) avant chaque comparaison |
| Preuve non liée à un compte | vol de preuve, ou un tiers qui grille la place d'un prouveur honnête | compte XRPL de Marco en entrée publique, contrôlé par le vérificateur |
| Signature vérifiée hors du circuit | il faudrait révéler qui est le débiteur | signature vérifiée **dans** le circuit (d'où le choix de BabyJubJub) |
| Pseudonyme sans portée | tous les prêts d'un débiteur deviennent reliables pour toujours | `P` dépend du millésime du fonds |
| Entrées publiques non confrontées au ledger | une preuve valide, mais pour une autre liste, un autre compte ou un autre prêt | le vérificateur contrôle chaque entrée publique : racine publiée on-chain, compte de la PME = émetteur du token = emprunteur, échéance et seuil cohérents avec le prêt, `networkId`, registre |

---

## Annexe D — Les tentatives de fraude et ce qui les bloque

| Marco tente… | Ce qui le bloque |
|---|---|
| de refinancer la même facture avec le même compte | le ledger : `tecDUPLICATE`, qui fait échouer tout le bloc du certificat |
| de modifier un champ (10 001 €) pour obtenir une autre empreinte | la signature de la mairie ne correspond plus : pas de preuve possible |
| de faire signer la facture une deuxième fois | même numéro → même `uuid` → même empreinte → `tecDUPLICATE` |
| de faire financer la facture sur une autre chaîne | `networkId` et registre dans le message signé : l'attestation y est inutilisable |
| de passer par un autre compte XRPL | son compte est dans le message signé : pas de preuve possible |
| d'inventer une facture | aucun débiteur de la liste ne l'a signée : pas de preuve possible |
| de copier la preuve d'une autre PME | la preuve est liée au compte de cette PME |
| de supprimer son enregistrement puis de le recréer | l'historique public garde trace de la première empreinte, et seul un prêt qui la référence compte |

---

## Annexe E — Modèle de menace

| Menace | Défense | Risque résiduel |
|---|---|---|
| Fausse facture | signature d'un débiteur de la liste vérifiée | collusion avec un vrai débiteur, qui s'engage alors à payer |
| Double financement chez Bari | empreinte + `tecDUPLICATE` | — |
| Double financement sur une autre chaîne | `networkId` dans le message ; une seule attestation par facture | erreur du débiteur, détectable (même empreinte) |
| Double financement hors blockchain | toute banque qui reçoit l'attestation peut vérifier l'empreinte | banque qui ne vérifie pas |
| Prêt accordé sans enregistrement préalable | ordre imposé : certificat (`Batch`) avant prêt ; une facture est financée si et seulement si un prêt la référence | fenêtre entre certificat et prêt : la facture reste réservée à Bari |
| Concentration cachée sur un débiteur | pseudonyme `P` et plafond par pseudonyme, vérifiables par tous | liste de débiteurs trop petite : `P` et les montants aident à deviner le débiteur |
| Vol ou copie d'une preuve | preuve liée au compte de la PME | — |
| Montant falsifié par débordement | contrôles de bornes dans le circuit | bug d'implémentation : audit du circuit |
| Force brute sur l'empreinte | `uuid` calculé avec le secret du débiteur | fuite du secret du débiteur |
| Compromission du trusted setup | cérémonie multi-contributeurs (un honnête suffit) | migration possible vers PLONK ou STARK |
| PME qui encaisse sans rembourser | mise en première perte de Bari, puis le vault | risque de crédit classique |
| Défaut du débiteur | idem | faible pour une administration (retard plutôt que défaut) |
| Bari malhonnête | ne peut pas puiser dans le vault (pseudo-compte) ; prêts audités publiquement ; sa mise est perdue en premier ; multisig k-sur-n du broker en option | refus arbitraire de prêts |
| Enclave compromise (option Phala) | l'enclave n'est qu'un signataire parmi k | — |
| Indexeur malhonnête | tout le monde peut tout re-vérifier depuis le ledger public | — |
| Ordinateur quantique | hachages résistants | forge de preuves Groth16 : migration vers STARK |

---

## Annexe F — Droit italien

- **Un jeton ne vaut pas cession juridique.** L'art. 1265 du Code civil fait dépendre la priorité entre cessionnaires de la notification au débiteur, ou de son acceptation par un acte à date certaine. Pour une créance sur une administration de l'État, il faut en plus un acte notarié.
- **Dans le modèle B, il n'y a pas de cession :** c'est un **prêt** dont la facture est le justificatif. Le token facture remis à Bari est une preuve et une entrée de registre, pas un titre juridique.
- **Accroche pour le jury :** « l'art. 1265 dit déjà que la première cession notifiée l'emporte ; Bari rend cette règle automatique et préventive ».
- **Valeur probante d'un enregistrement on-chain.** Selon l'art. 8-ter du décret-loi 135/2018 (converti par la loi 12/2019), la mémorisation d'un document sur un registre distribué produit les effets juridiques d'une **validation temporelle électronique** au sens de l'art. 41 du règlement eIDAS. C'est une piste pour la « date certaine », à faire valider par un juriste.
- **KYC et KYB.** Un prestataire délivre un credential à chaque investisseur, à chaque PME et à Bari ; seul un compte muni du bon credential peut déposer dans le vault privé.
- **Outils réglementaires.** L'émetteur d'euro numérique dispose du clawback et du gel (y compris le gel profond) : les autorités gardent la main sur les fonds, comme dans le système bancaire.

---

## Annexe G — Sources

**XRPL**
- Lending Protocol : https://xrpl.org/docs/concepts/tokens/lending-protocol
- XLS-66 : https://xls.xrpl.org/xls/xls-66
- Amendements connus : https://xrpl.org/resources/known-amendments
- VaultCreate : https://xrpl.org/docs/references/protocol/transactions/types/vaultcreate
- LoanSet : https://xrpl.org/docs/references/protocol/transactions/types/loanset
- LoanBrokerSet : https://xrpl.org/docs/references/protocol/transactions/types/loanbrokerset
- CredentialCreate : https://xrpl.org/docs/references/protocol/transactions/types/credentialcreate
- MPTokenIssuanceCreate : https://xrpl.org/docs/references/protocol/transactions/types/mptokenissuancecreate
- Batch : https://xrpl.org/docs/references/protocol/transactions/types/batch
- Confidential Transfers (XLS-96) : https://xrpl.org/docs/concepts/tokens/fungible-tokens/confidential-transfers
- Code d'exemple officiel du Lending Protocol : https://github.com/XRPLF/xrpl-dev-portal/tree/master/_code-samples/lending-protocol/
- Smart contracts XRPL (XLS-101) : https://xls.xrpl.org/xls/XLS-0101-smart-contracts.html
- AlphaNet, présentation par XRPL Labs : https://dev.to/dangell7/smart-contracts-on-xrpls-alphanet-1loo

**Marché et fraude**
- FCI, statistiques 2025 : https://fci.nl/en/news/fci-releases-2025-world-industry-statistics-global-factoring-market-surpasses-eu4-trillion
- First Brands, Reuters : https://www.reuters.com/world/us/first-brands-creditor-says-23-billion-simply-vanished-seeks-probe-2025-10-09
- First Brands, GTR : https://www.gtreview.com/news/americas/first-brands-faces-investigation-into-double-financing-of-receivables-inventory
- First Brands, inculpations : https://www.irs.gov/compliance/criminal-investigation/first-brands-executives-charged-with-multibillion-dollar-fraud
- Bloomberg Law : https://news.bloomberglaw.com/bankruptcy-law/auto-bankruptcies-show-astounding-lapses-in-loan-paper-trail

**Solutions existantes**
- MonetaGo : https://docs.securefinancing.in/docs/Introduction/Solution%20Overview.html
- TReDS et MonetaGo : https://www.monetago.com/news/treds-platforms-transition-to-a-quicker-service-of-invoice-deduplication-with-the-adoption-of-global-standards
- PCC, certification des créances : https://area.rgs.mef.gov.it/canali/3/approfondimenti/PCC100016/breve-guida-alla-certificazione-dei-crediti/content-type
- Contour : https://www.gtreview.com/news/top-stories/exclusive-contour-to-shut-down-as-bank-shareholders-pull-funding
- Marco Polo : https://www.gtreview.com/news/top-stories/marco-polo-brings-in-liquidators-as-funds-run-dry

**Sécurité des enclaves (option Phala)**
- TEE.fail : https://tee.fail/
- Avis de sécurité Intel : https://www.intel.com/content/www/us/en/security-center/announcement/intel-security-announcement-2025-10-28-001.html

**Droit**
- Art. 1265 du Code civil : https://www.gazzettaufficiale.it/atto/serie_generale/caricaArticolo?art.codiceRedazionale=042U0262&art.dataPubblicazioneGazzetta=1942-04-04&art.flagTipoArticolo=2&art.idArticolo=1265&art.idGruppo=157&art.idSottoArticolo=1&art.idSottoArticolo1=10&art.progressivo=0&art.versione=1
- Art. 8-ter du D.L. 135/2018 : https://www.gazzettaufficiale.it/atto/serie_generale/caricaArticolo?art.codiceRedazionale=19A00934&art.dataPubblicazioneGazzetta=2019-02-12&art.flagTipoArticolo=0&art.idArticolo=8&art.idGruppo=0&art.idSottoArticolo=3&art.idSottoArticolo1=10&art.progressivo=0&art.versione=1
- CJUE, Commission c. Italie (C-122/18) : https://curia.europa.eu/site/upload/docs/application/pdf/2020-01/cp200007en.pdf
- EIP-155 : https://eips.ethereum.org/EIPS/eip-155

**Hackathon**
- Slides officielles IXH26 : `IXH26 Bari - Welcome Slides.pdf` (fichier local)
