#!/usr/bin/env bash
# Lance (ou relance) le nœud alphanet local sur hermes : bash infra/alphanet/run.sh
# ATTENTION : chaque lancement repart d'un ledger genesis neuf (voir node-entrypoint.sh), tout l'état est perdu.
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

STOP_TIMEOUT_S=60
if docker container inspect "$CONTAINER" >/dev/null 2>&1; then
    docker stop --time "$STOP_TIMEOUT_S" "$CONTAINER" >/dev/null
    docker rm "$CONTAINER" >/dev/null
fi

mkdir -p "$DATA_DIR"
cat "$SCRIPT_DIR/xrpld.cfg" "$SCRIPT_DIR/amendments.cfg" > "$DATA_DIR/xrpld.cfg"

docker run --detach --name "$CONTAINER" \
    --restart unless-stopped \
    --network host \
    --user "$(id -u):$(id -g)" \
    --memory "$NODE_MEMORY" \
    --log-opt max-size=20m --log-opt max-file=3 \
    --env LEDGER_CLOSE_SECONDS \
    --volume "$DATA_DIR:/var/lib/xrpld" \
    --volume "$XRPLD_BIN:/usr/local/bin/xrpld:ro" \
    --volume "$SCRIPT_DIR/node-entrypoint.sh:/entrypoint.sh:ro" \
    "$BUILD_IMAGE" bash /entrypoint.sh

echo "Nœud lancé. Logs : docker logs -f $CONTAINER"
