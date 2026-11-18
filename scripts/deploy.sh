#!/usr/bin/env bash
# Production deploy, run ON THE SERVER inside the project checkout.
#
#   scripts/deploy.sh <commit-sha>
#
# Called by the `deploy` job of .github/workflows/ci.yml after every test passed on `main`.
# Can also be run by hand. It:
#   1. moves the checkout to exactly the tested commit (tracked files only: .env, TLS
#      certificates and Docker volumes are untouched),
#   2. rebuilds the images and restarts the stack (the `migrate` service applies migrations),
#   3. waits until backend, frontend and nginx report healthy,
#   4. removes dangling images so the disk does not fill up.
# Any failure exits non-zero, which marks the GitHub deploy job red.
#
# Compose file: plain `docker compose` with docker-compose.yml. TLS is terminated by the
# reverse proxy on the host (see docs/DOCKER.md, "Production").
set -euo pipefail

SHA="${1:?usage: scripts/deploy.sh <commit-sha>}"
COMPOSE=(docker compose)
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-300}"

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "error: .env is missing in $(pwd); create it before the first deploy" >&2
  exit 1
fi

echo "==> Fetching $SHA"
git fetch --quiet origin main
git cat-file -e "$SHA^{commit}"
git reset --quiet --hard "$SHA"
echo "    now at $(git log --oneline -1)"

echo "==> Building and starting the stack"
"${COMPOSE[@]}" up -d --build

echo "==> Waiting for services to become healthy (up to ${HEALTH_TIMEOUT_SECONDS}s)"
deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
for service in backend frontend nginx; do
  while :; do
    id="$("${COMPOSE[@]}" ps -q "$service")"
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || echo missing)"
    case "$status" in
      healthy | running) echo "    $service: $status"; break ;;
      unhealthy | exited | dead | missing)
        echo "error: $service is $status" >&2
        "${COMPOSE[@]}" logs --tail 80 "$service" >&2 || true
        exit 1 ;;
    esac
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "error: $service still $status after ${HEALTH_TIMEOUT_SECONDS}s" >&2
      "${COMPOSE[@]}" logs --tail 80 "$service" >&2 || true
      exit 1
    fi
    sleep 5
  done
done

echo "==> Cleaning up old images"
docker image prune -f > /dev/null

echo "==> Deployed $(git rev-parse --short HEAD)"
