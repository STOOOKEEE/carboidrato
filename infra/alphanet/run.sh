#!/usr/bin/env bash
# Lance (ou relance) le nœud alphanet local sur hermes.
# Usage : bash infra/alphanet/run.sh          reprend l'état existant
#         RESET=1 bash infra/alphanet/run.sh  repart d'un ledger genesis neuf
# Sécurité : réseau host + xrpld lié à 127.0.0.1 ; AUCUN port Docker publié (Docker contournerait le firewall).
set -euo pipefail

ALPHANET_DIR="${ALPHANET_DIR:-$HOME/dev/xrpl-alphanet}"
BUILD_IMAGE="xrpl-alphanet-build"
CONTAINER="xrpl-alphanet"
NODE_MEMORY="${NODE_MEMORY:-4g}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="$ALPHANET_DIR/data"
XRPLD_BIN="$ALPHANET_DIR/rippled/build/xrpld"

if [[ ! -x "$XRPLD_BIN" ]]; then
    echo "Binaire introuvable : $XRPLD_BIN (lancer build.sh d'abord)" >&2
    exit 1
fi

if docker container inspect "$CONTAINER" >/dev/null 2>&1; then
    docker rm --force "$CONTAINER" >/dev/null
fi

mkdir -p "$DATA_DIR"
if [[ "${RESET:-0}" == "1" ]]; then
    rm -rf "$DATA_DIR/db" "$DATA_DIR/debug.log"
fi
cat "$SCRIPT_DIR/xrpld.cfg" "$SCRIPT_DIR/amendments.cfg" > "$DATA_DIR/xrpld.cfg"

docker run --detach --name "$CONTAINER" \
    --restart unless-stopped \
    --network host \
    --user "$(id -u):$(id -g)" \
    --memory "$NODE_MEMORY" \
    --env LEDGER_CLOSE_SECONDS \
    --volume "$DATA_DIR:/var/lib/xrpld" \
    --volume "$XRPLD_BIN:/usr/local/bin/xrpld:ro" \
    --volume "$SCRIPT_DIR/node-entrypoint.sh:/entrypoint.sh:ro" \
    "$BUILD_IMAGE" bash /entrypoint.sh

echo "Nœud lancé. Logs : docker logs -f $CONTAINER"
