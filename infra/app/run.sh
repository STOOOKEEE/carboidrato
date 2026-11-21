#!/usr/bin/env bash
# Sur hermes : installe, compile et (re)lance l'application Bari (API du fonds + front), puis l'expose par un
# tunnel Cloudflare. Lancé par infra/app/deploy.sh depuis le Mac ; INIT_FUND=1 crée d'abord le fonds (demo:fund).
# Sécurité : API et front écoutent sur 127.0.0.1 uniquement ; seul le front est exposé, par connexion sortante.
set -euo pipefail

APP_ROOT="${APP_ROOT:-$HOME/dev/bari-app}"
CODE_DIR="$APP_ROOT/code"
STATE_DIR="$APP_ROOT/state"
ENV_FILE="$STATE_DIR/app.env"
NODE_IMAGE="node:22-bookworm"
CLOUDFLARED_IMAGE="cloudflare/cloudflared:2026.10.0"
API_CONTAINER="bari-api"
WEB_CONTAINER="bari-web"
TUNNEL_CONTAINER="bari-web-public"
API_PORT=8798
WEB_PORT=4180
STOP_TIMEOUT_S=30
URL_WAIT_SECONDS=30

if [[ ! -f "$ENV_FILE" ]]; then
    cat >&2 <<EOF
Fichier d'environnement absent : $ENV_FILE. À créer une fois, par exemple :
  XRPL_WS=wss://<tunnel public du nœud alphanet>
  XRPL_GENESIS_SEED=<seed genesis du nœud standalone>
  XRPL_WALLETS_FILE=/state/.wallets.alphanet.json
EOF
    exit 1
fi

# Commande Node dans un conteneur jetable : code et état montés, mêmes droits que l'utilisateur hermes.
node_in_docker() {
    docker run --rm --network host --user "$(id -u):$(id -g)" \
        --env HOME=/state --env-file "$ENV_FILE" --env API_FUND_PORT="$API_PORT" --env API_PORT="$API_PORT" \
        --volume "$CODE_DIR:/app" --volume "$STATE_DIR:/state" --workdir /app \
        "$NODE_IMAGE" "$@"
}

stop_container() {
    if docker container inspect "$1" >/dev/null 2>&1; then
        docker stop --time "$STOP_TIMEOUT_S" "$1" >/dev/null
        docker rm "$1" >/dev/null
    fi
}

start_service() {
    local name="$1"
    shift
    docker run --detach --name "$name" --restart unless-stopped --network host --user "$(id -u):$(id -g)" \
        --log-opt max-size=20m --log-opt max-file=3 \
        --env HOME=/state --env-file "$ENV_FILE" --env API_FUND_PORT="$API_PORT" --env API_PORT="$API_PORT" \
        --volume "$CODE_DIR:/app" --volume "$STATE_DIR:/state" --workdir /app \
        "$NODE_IMAGE" "$@" >/dev/null
}

echo "== Installation et build du front"
node_in_docker npm ci --no-audit --no-fund
node_in_docker npm run web:build

if [[ "${INIT_FUND:-0}" == "1" ]]; then
    echo "== Création du fonds et des comptes du pitch (demo:fund)"
    stop_container "$API_CONTAINER"
    # demo:fund écrit les identifiants du pitch dans .hack/ (gitignoré, donc absent de l'archive déployée).
    mkdir -p "$CODE_DIR/.hack" && chmod 700 "$CODE_DIR/.hack"
    node_in_docker npm run demo:fund
fi

echo "== (Re)lancement de l'API (127.0.0.1:$API_PORT) et du front (127.0.0.1:$WEB_PORT)"
stop_container "$API_CONTAINER"
stop_container "$WEB_CONTAINER"
start_service "$API_CONTAINER" npm run api:fund
start_service "$WEB_CONTAINER" npx vite preview web --host 127.0.0.1 --port "$WEB_PORT" --strictPort

# Le tunnel n'est recréé que s'il n'existe pas : son URL publique reste la même d'un déploiement à l'autre.
if ! docker container inspect "$TUNNEL_CONTAINER" >/dev/null 2>&1; then
    docker run --detach --name "$TUNNEL_CONTAINER" --restart unless-stopped --network host \
        --log-opt max-size=5m --log-opt max-file=2 \
        "$CLOUDFLARED_IMAGE" tunnel --no-autoupdate --url "http://127.0.0.1:$WEB_PORT" \
        --http-host-header "127.0.0.1:$WEB_PORT" >/dev/null
fi
for _ in $(seq "$URL_WAIT_SECONDS"); do
    url=$(docker logs "$TUNNEL_CONTAINER" 2>&1 | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1 || true)
    if [[ -n "$url" ]]; then
        echo "Application publique : $url"
        exit 0
    fi
    sleep 1
done
echo "URL du tunnel introuvable : docker logs $TUNNEL_CONTAINER" >&2
exit 1
