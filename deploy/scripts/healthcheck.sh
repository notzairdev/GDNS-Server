#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"

compose=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

echo "== Compose status =="
"${compose[@]}" ps

echo "== Container health =="
for container in gdns-adguardhome gdns-api gdns-caddy; do
  status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container")"
  echo "$container: $status"
  if [ "$status" != "healthy" ] && [ "$status" != "running" ]; then
    exit 1
  fi
done

echo "== API health =="
"${compose[@]}" exec -T api node -e "fetch('http://127.0.0.1:4000/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

echo "== AdGuardHome HTTP health =="
"${compose[@]}" exec -T adguardhome wget -q -O /dev/null http://127.0.0.1:3000/

echo "== Caddy config health =="
"${compose[@]}" exec -T caddy caddy validate --config /etc/caddy/Caddyfile

echo "GDNS healthcheck passed"
