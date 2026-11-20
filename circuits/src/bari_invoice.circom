pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/eddsaposeidon.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "./merkle.circom";

// Constantes de l'énoncé (IDEE §7.3). Toute modification impose un nouveau setup
// et doit être répercutée dans src/zk/constants.ts.

// Domaine de séparation de l'empreinte N : ASCII "bari.nullifier.v1" lu en entier big-endian.
function DOMAIN_N() { return 0x626172692e6e756c6c69666965722e7631; }

// Domaine de séparation du pseudonyme P : ASCII "bari.pseudonym.v1" lu en entier big-endian.
function DOMAIN_P() { return 0x626172692e70736575646f6e796d2e7631; }

// Profondeur fixe de l'arbre des débiteurs vérifiés : 2^8 = 256 débiteurs par liste.
function MERKLE_DEPTH() { return 8; }

// Largeur en bits des montants (en centimes) et du seuil, imposée avant toute comparaison.
function AMOUNT_BITS() { return 64; }

template BariInvoice(depth) {
    // --- Données privées ---
    signal input amount;               // montant de la facture, en centimes
    signal input uuid;                 // HMAC-SHA256(secret débiteur, n° officiel), réduit à 31 octets
    signal input debtorAx;             // clé publique BabyJubJub du débiteur
    signal input debtorAy;
    signal input sigR8x;               // signature EdDSA-Poseidon du débiteur sur m
    signal input sigR8y;
    signal input sigS;
    signal input pathElements[depth];  // chemin Merkle de la feuille Poseidon(Ax, Ay)
    signal input pathIndices[depth];
    signal input blinding;             // aléa r de l'engagement : n'entre QUE dans C (annexe C)

    // --- Données publiques ---
    signal input debtorsRoot;          // racine de la liste des débiteurs vérifiés
    signal input account;              // AccountID XRPL de la PME (20 octets, entier big-endian)
    signal input threshold;            // seuil de montant, en centimes
    signal input dueDate;              // échéance de la facture
    signal input networkId;            // NetworkID XRPL (anti-rejeu inter-chaînes)
    signal input registry;             // AccountID du registre Bari
    signal input vintage;              // millésime du fonds (portée du pseudonyme)

    // --- Sorties publiques ---
    signal output commitment;          // C = Poseidon(m, r)
    signal output nullifier;           // N = Poseidon(DOMAINE_N, uuid)
    signal output pseudonym;           // P = Poseidon(DOMAINE_P, Ax, Ay, millésime)

    // 1. Message attesté par le débiteur.
    component message = Poseidon(8);
    message.inputs[0] <== account;
    message.inputs[1] <== debtorAx;
    message.inputs[2] <== debtorAy;
    message.inputs[3] <== amount;
    message.inputs[4] <== dueDate;
    message.inputs[5] <== uuid;
    message.inputs[6] <== networkId;
    message.inputs[7] <== registry;

    // 2. Signature EdDSA-Poseidon du débiteur sur m, vérifiée dans le circuit.
    component signature = EdDSAPoseidonVerifier();
    signature.enabled <== 1;
    signature.Ax <== debtorAx;
    signature.Ay <== debtorAy;
    signature.R8x <== sigR8x;
    signature.R8y <== sigR8y;
    signature.S <== sigS;
    signature.M <== message.out;

    // 3. Poseidon(Ax, Ay) appartient à la liste des débiteurs vérifiés.
    component leaf = Poseidon(2);
    leaf.inputs[0] <== debtorAx;
    leaf.inputs[1] <== debtorAy;
    component merkle = MerkleRoot(depth);
    merkle.leaf <== leaf.out;
    for (var i = 0; i < depth; i++) {
        merkle.pathElements[i] <== pathElements[i];
        merkle.pathIndices[i] <== pathIndices[i];
    }
    merkle.root === debtorsRoot;

    // 4. montant ≥ seuil, après décomposition en bits des deux opérandes (anti-débordement).
    component amountBits = Num2Bits(AMOUNT_BITS());
    amountBits.in <== amount;
    component thresholdBits = Num2Bits(AMOUNT_BITS());
    thresholdBits.in <== threshold;
    component sufficient = GreaterEqThan(AMOUNT_BITS());
    sufficient.in[0] <== amount;
    sufficient.in[1] <== threshold;
    sufficient.out === 1;

    // 5. Sorties publiques.
    component commitmentHash = Poseidon(2);
    commitmentHash.inputs[0] <== message.out;
    commitmentHash.inputs[1] <== blinding;
    commitment <== commitmentHash.out;

    component nullifierHash = Poseidon(2);
    nullifierHash.inputs[0] <== DOMAIN_N();
    nullifierHash.inputs[1] <== uuid;
    nullifier <== nullifierHash.out;

    component pseudonymHash = Poseidon(4);
    pseudonymHash.inputs[0] <== DOMAIN_P();
    pseudonymHash.inputs[1] <== debtorAx;
    pseudonymHash.inputs[2] <== debtorAy;
    pseudonymHash.inputs[3] <== vintage;
    pseudonym <== pseudonymHash.out;
}

component main {public [debtorsRoot, account, threshold, dueDate, networkId, registry, vintage]} = BariInvoice(MERKLE_DEPTH());
