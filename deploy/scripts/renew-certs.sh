#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"

compose=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

certificate_digest() {
  find certs/runtime -type f -print0 2>/dev/null \
    | sort -z \
    | xargs -0r sha256sum \
    | sha256sum \
    | cut -d' ' -f1
}

before_digest="$(certificate_digest)"
"${compose[@]}" --profile certs run --rm -T certbot </dev/null
after_digest="$(certificate_digest)"

if [ "$before_digest" = "$after_digest" ]; then
  echo "GDNS certificates already current"
  exit 0
fi

"${compose[@]}" restart adguardhome

for _ in $(seq 1 30); do
  status="$(
    docker inspect -f \
      '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
      gdns-adguardhome
  )"
  if [ "$status" = "healthy" ]; then
    echo "GDNS certificates renewed and AdGuardHome is healthy"
    exit 0
  fi
  sleep 2
done

"${compose[@]}" logs --tail=100 adguardhome >&2
echo "AdGuardHome did not become healthy after certificate renewal" >&2
exit 1
