#!/usr/bin/env bash
# Entrypoint du conteneur : xrpld en standalone + fermeture périodique des ledgers.
set -euo pipefail

CONF=/var/lib/xrpld/xrpld.cfg
LEDGER_CLOSE_SECONDS="${LEDGER_CLOSE_SECONDS:-3}"

# Premier démarrage : ledger genesis neuf (amendments de [amendments] activés). Ensuite : reprise de l'état.
if [[ -d /var/lib/xrpld/db/nudb ]]; then
    START_MODE=--load
else
    START_MODE=--start
fi

xrpld --conf "$CONF" --standalone "$START_MODE" &
XRPLD_PID=$!
trap 'kill "$XRPLD_PID"' TERM INT

until xrpld --conf "$CONF" server_info >/dev/null 2>&1; do
    kill -0 "$XRPLD_PID"
    sleep 1
done
echo "xrpld prêt ($START_MODE), fermeture d'un ledger toutes les ${LEDGER_CLOSE_SECONDS}s"

# En standalone, rien ne ferme les ledgers : on le fait nous-mêmes tant que xrpld tourne.
while kill -0 "$XRPLD_PID" 2>/dev/null; do
    xrpld --conf "$CONF" ledger_accept >/dev/null
    sleep "$LEDGER_CLOSE_SECONDS"
done
wait "$XRPLD_PID"
