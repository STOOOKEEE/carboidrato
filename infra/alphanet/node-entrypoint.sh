#!/usr/bin/env bash
# Entrypoint du conteneur : xrpld en standalone + fermeture périodique des ledgers.
set -euo pipefail

CONF=/var/lib/xrpld/xrpld.cfg
LEDGER_CLOSE_SECONDS="${LEDGER_CLOSE_SECONDS:-3}"

# Toujours un ledger genesis neuf (amendments de [amendments] activés) : en standalone, ce build n'écrit aucun
# ledger en base (table Ledgers vide après des minutes d'activité, cause non identifiée), donc --load échoue.
# Conséquence assumée : chaque redémarrage du conteneur remet la chaîne à zéro.
rm -rf /var/lib/xrpld/db
xrpld --conf "$CONF" --standalone --start &
XRPLD_PID=$!
trap 'kill "$XRPLD_PID"; wait "$XRPLD_PID"; exit 0' TERM INT

until xrpld --conf "$CONF" server_info >/dev/null 2>&1; do
    kill -0 "$XRPLD_PID"
    sleep 1
done
echo "xrpld prêt (genesis neuf), fermeture d'un ledger toutes les ${LEDGER_CLOSE_SECONDS}s"

# En standalone, rien ne ferme les ledgers : on le fait nous-mêmes tant que xrpld tourne.
while kill -0 "$XRPLD_PID" 2>/dev/null; do
    xrpld --conf "$CONF" ledger_accept >/dev/null 2>&1 || echo "ledger_accept a échoué" >&2
    sleep "$LEDGER_CLOSE_SECONDS"
done
wait "$XRPLD_PID"
