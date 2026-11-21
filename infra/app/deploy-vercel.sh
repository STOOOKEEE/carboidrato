#!/usr/bin/env bash
# Depuis le Mac : publie sur Vercel (projet atlas-invoice → https://atlas-invoices.vercel.app) le front déjà
# compilé sur hermes par run.sh, avec /api/* relayé vers l'API de hermes par son tunnel Cloudflare.
# À relancer après chaque deploy.sh, ou si l'URL du tunnel bari-web-public change.
set -euo pipefail

SSH_HOST="${SSH_HOST:-hermes}"
VERCEL_PROJECT="atlas-invoice"
VERCEL_ALIAS="atlas-invoices.vercel.app"
TUNNEL_CONTAINER="bari-web-public"
WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT

TUNNEL_URL=$(ssh "$SSH_HOST" "docker logs $TUNNEL_CONTAINER 2>&1" | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1)
if [[ -z "$TUNNEL_URL" ]]; then
    echo "URL du tunnel $TUNNEL_CONTAINER introuvable sur $SSH_HOST" >&2
    exit 1
fi

rsync -a "$SSH_HOST:dev/bari-app/code/web/dist/" "$WORK_DIR/"
cat > "$WORK_DIR/vercel.json" <<EOF
{ "rewrites": [{ "source": "/api/:path*", "destination": "$TUNNEL_URL/api/:path*" }] }
EOF

cd "$WORK_DIR"
vercel link --yes --project "$VERCEL_PROJECT" >/dev/null
DEPLOYMENT=$(vercel deploy --prod --yes 2>/dev/null | grep -oE 'https://[a-z0-9-]+\.vercel\.app' | head -1)
vercel alias set "$DEPLOYMENT" "$VERCEL_ALIAS" >/dev/null
echo "Front : https://$VERCEL_ALIAS (API relayée vers $TUNNEL_URL)"
