pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";

// Recalcule la racine d'un arbre de Merkle Poseidon binaire à partir d'une feuille et de son chemin.
// pathIndices[i] = 0 : le nœud courant est à gauche au niveau i ; 1 : il est à droite.
template MerkleRoot(depth) {
    signal input leaf;
    signal input pathElements[depth];
    signal input pathIndices[depth];
    signal output root;

    component hashers[depth];
    signal current[depth + 1];
    signal swap[depth];
    current[0] <== leaf;

    for (var i = 0; i < depth; i++) {
        // Un indice non booléen permettrait de fabriquer une racine arbitraire.
        pathIndices[i] * (1 - pathIndices[i]) === 0;

        // swap = 0 si le nœud courant est à gauche, (frère - courant) sinon.
        swap[i] <== pathIndices[i] * (pathElements[i] - current[i]);

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== current[i] + swap[i];
        hashers[i].inputs[1] <== pathElements[i] - swap[i];
        current[i + 1] <== hashers[i].out;
    }

    root <== current[depth];
}
