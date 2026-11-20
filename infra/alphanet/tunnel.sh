#!/usr/bin/env bash
# Depuis le Mac : expose le nœud alphanet de hermes en local via SSH (seul accès possible).
# Ensuite : XRPL_WS=ws://127.0.0.1:51233
set -euo pipefail

SSH_HOST="${SSH_HOST:-hermes}"
WS_PORT=51233
RPC_PORT=51234

echo "Tunnel actif : ws://127.0.0.1:$WS_PORT et http://127.0.0.1:$RPC_PORT (Ctrl-C pour arrêter)"
exec ssh -N -o ExitOnForwardFailure=yes \
    -L "127.0.0.1:$WS_PORT:127.0.0.1:$WS_PORT" \
    -L "127.0.0.1:$RPC_PORT:127.0.0.1:$RPC_PORT" \
    "$SSH_HOST"
