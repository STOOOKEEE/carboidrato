#!/usr/bin/env bash
# Depuis le Mac : déploie une révision du dépôt GitHub sur hermes, puis lance infra/app/run.sh là-bas.
# Usage : bash infra/app/deploy.sh [révision]            (défaut : origin/hack/night)
#         INIT_FUND=1 bash infra/app/deploy.sh [révision] (premier déploiement, ou après un reset du nœud)
# Le code est remplacé à chaque déploiement ; l'état (wallets, fonds, comptes, app.env) reste dans state/.
set -euo pipefail

REVISION="${1:-origin/hack/night}"
SSH_HOST="${SSH_HOST:-hermes}"
APP_ROOT_REMOTE="dev/bari-app"

git fetch --quiet origin
COMMIT=$(git rev-parse --short "$REVISION")
echo "== Déploiement de $REVISION ($COMMIT) sur $SSH_HOST"

ssh "$SSH_HOST" "mkdir -p $APP_ROOT_REMOTE/state $APP_ROOT_REMOTE/code && rm -rf $APP_ROOT_REMOTE/incoming && mkdir $APP_ROOT_REMOTE/incoming"
git archive --format=tar "$REVISION" | ssh "$SSH_HOST" "tar -x -C $APP_ROOT_REMOTE/incoming"
# node_modules, le build du front et .hack/ (identifiants des comptes du pitch écrits par demo:fund, gitignorés)
# sont conservés entre deux déploiements.
ssh "$SSH_HOST" "rsync -a --delete --exclude node_modules --exclude web/dist --exclude .hack $APP_ROOT_REMOTE/incoming/ $APP_ROOT_REMOTE/code/ \
    && rm -rf $APP_ROOT_REMOTE/incoming && echo $COMMIT > $APP_ROOT_REMOTE/code/.deployed-commit"
# run.sh vient du poste local : il fait partie de l'outillage de déploiement, pas forcément de la révision déployée.
ssh "$SSH_HOST" "INIT_FUND=${INIT_FUND:-0} bash -s" < "$(dirname "$0")/run.sh"
