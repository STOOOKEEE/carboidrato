#!/usr/bin/env bash
# Setup Groth16 reproductible du circuit Bari (IDEE §7.7) :
#   compilation → ptau public Hermez (vérifié par empreinte) → phase 2 à deux contributions
#   → beacon public → vérification de la zkey → export de la clé de vérification et du wasm.
# Les gros fichiers (ptau, zkey, r1cs) restent dans circuits/build (gitignoré) ;
# le wasm et la vkey, nécessaires à l'API src/zk, vont dans circuits/artifacts.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CIRCUITS="$ROOT/circuits"
BUILD="$CIRCUITS/build"
ARTIFACTS="$CIRCUITS/artifacts"
CIRCOM="$CIRCUITS/.tools/bin/circom"
SNARKJS="$ROOT/node_modules/.bin/snarkjs"
CIRCUIT_NAME="bari_invoice"

# Powers of Tau publics de Hermez, 2^15 contraintes (le circuit en compte ~7 800 : marge pour l'option §7.6).
PTAU_POWER=15
PTAU_FILE="$BUILD/powersOfTau28_hez_final_${PTAU_POWER}.ptau"
# URL officielle (403 constaté le 20/11/2026), puis miroir GitHub. L'empreinte fait foi, pas la source.
PTAU_URLS=(
  "https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_${PTAU_POWER}.ptau"
  "https://raw.githubusercontent.com/enricobottazzi/ZK-SBT/main/powersOfTau28_hez_final_${PTAU_POWER}.ptau"
)
# Empreinte blake2b-512 publiée dans le README de snarkjs.
PTAU_BLAKE2B="982372c867d229c236091f767e703253249a9b432c1710b4f326306bfa2428a17b06240359606cfe4d580b10a5a1f63fbed499527069c18ae17060472969ae6e"

# Beacon public final : hash d'un bloc/ledger publié après les contributions.
# Valeur de démo documentée ; en production, un hash de ledger XRPL futur annoncé à l'avance.
BEACON_HASH="0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20"
BEACON_ITERATIONS_EXP=10

if [[ ! -x "$CIRCOM" ]]; then
  echo "circom absent : lancer d'abord 'npm run zk:install-circom'" >&2
  exit 1
fi

mkdir -p "$BUILD" "$ARTIFACTS"

echo "== Compilation du circuit"
"$CIRCOM" "$CIRCUITS/src/$CIRCUIT_NAME.circom" --O2 --r1cs --wasm --sym \
  -l "$ROOT/node_modules" -o "$BUILD"
"$SNARKJS" r1cs info "$BUILD/$CIRCUIT_NAME.r1cs"

echo "== Powers of Tau Hermez (2^$PTAU_POWER)"
for url in "${PTAU_URLS[@]}"; do
  [[ -f "$PTAU_FILE" ]] && break
  if curl -fsSL --retry 3 -o "$PTAU_FILE.part" "$url"; then
    mv "$PTAU_FILE.part" "$PTAU_FILE"
  else
    echo "Téléchargement impossible depuis $url, essai suivant." >&2
  fi
done
if [[ ! -f "$PTAU_FILE" ]]; then
  echo "Aucune source du ptau n'a répondu." >&2
  exit 1
fi
ACTUAL_BLAKE2B="$(node -e 'const { createHash } = require("node:crypto"); const { readFileSync } = require("node:fs"); console.log(createHash("blake2b512").update(readFileSync(process.argv[1])).digest("hex"))' "$PTAU_FILE")"
if [[ "$ACTUAL_BLAKE2B" != "$PTAU_BLAKE2B" ]]; then
  echo "Empreinte du ptau invalide : $ACTUAL_BLAKE2B" >&2
  exit 1
fi
echo "Empreinte blake2b du ptau conforme."

echo "== Phase 2 : setup initial"
"$SNARKJS" groth16 setup "$BUILD/$CIRCUIT_NAME.r1cs" "$PTAU_FILE" "$BUILD/${CIRCUIT_NAME}_0000.zkey"

echo "== Phase 2 : contribution 1"
"$SNARKJS" zkey contribute "$BUILD/${CIRCUIT_NAME}_0000.zkey" "$BUILD/${CIRCUIT_NAME}_0001.zkey" \
  --name="Contributeur Bari 1" -e="$(openssl rand -hex 32)"

echo "== Phase 2 : contribution 2"
"$SNARKJS" zkey contribute "$BUILD/${CIRCUIT_NAME}_0001.zkey" "$BUILD/${CIRCUIT_NAME}_0002.zkey" \
  --name="Contributeur Bari 2" -e="$(openssl rand -hex 32)"

echo "== Phase 2 : beacon public"
"$SNARKJS" zkey beacon "$BUILD/${CIRCUIT_NAME}_0002.zkey" "$BUILD/${CIRCUIT_NAME}_final.zkey" \
  "$BEACON_HASH" "$BEACON_ITERATIONS_EXP" -n="Beacon final Bari"

echo "== Vérification de la zkey finale contre le r1cs et le ptau"
"$SNARKJS" zkey verify "$BUILD/$CIRCUIT_NAME.r1cs" "$PTAU_FILE" "$BUILD/${CIRCUIT_NAME}_final.zkey"

echo "== Export de la clé de vérification et du wasm"
"$SNARKJS" zkey export verificationkey "$BUILD/${CIRCUIT_NAME}_final.zkey" "$ARTIFACTS/verification_key.json"
cp "$BUILD/${CIRCUIT_NAME}_js/$CIRCUIT_NAME.wasm" "$ARTIFACTS/$CIRCUIT_NAME.wasm"
rm -f "$BUILD/${CIRCUIT_NAME}_0000.zkey" "$BUILD/${CIRCUIT_NAME}_0001.zkey" "$BUILD/${CIRCUIT_NAME}_0002.zkey"

echo "Setup terminé : $ARTIFACTS/verification_key.json, $ARTIFACTS/$CIRCUIT_NAME.wasm, $BUILD/${CIRCUIT_NAME}_final.zkey"
