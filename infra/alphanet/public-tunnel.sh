#!/usr/bin/env bash
# Expose le port WebSocket SANS admin du nœud (127.0.0.1:51236) via un tunnel Cloudflare (quick tunnel).
# Connexion sortante uniquement : aucun port n'est ouvert sur hermes, et seul ce WebSocket est joignable.
# À lancer sur hermes : bash infra/alphanet/public-tunnel.sh  → affiche l'URL wss:// à partager.
# L'URL change à chaque relance du conteneur.
set -euo pipefail

CONTAINER="xrpl-alphanet-public"
CLOUDFLARED_IMAGE="cloudflare/cloudflared:2026.10.0"
PUBLIC_WS_URL="http://127.0.0.1:51236"
URL_WAIT_SECONDS=30

if docker container inspect "$CONTAINER" >/dev/null 2>&1; then
    docker rm --force "$CONTAINER" >/dev/null
fi

docker run --detach --name "$CONTAINER" \
    --restart unless-stopped \
    --network host \
    --log-opt max-size=5m --log-opt max-file=2 \
    "$CLOUDFLARED_IMAGE" tunnel --no-autoupdate --url "$PUBLIC_WS_URL" >/dev/null

for _ in $(seq "$URL_WAIT_SECONDS"); do
    url=$(docker logs "$CONTAINER" 2>&1 | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | head -1 || true)
    if [[ -n "$url" ]]; then
        echo "WebSocket public : ${url/https:/wss:}"
        exit 0
    fi
    sleep 1
done
echo "URL du tunnel introuvable : docker logs $CONTAINER" >&2
exit 1
