#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

docker build -t gdns-caddy:check -f caddy/Dockerfile . >/dev/null
docker run --rm --env-file "$ENV_FILE" \
  -v "$(pwd)/caddy/Caddyfile:/etc/caddy/Caddyfile:ro" \
  gdns-caddy:check caddy adapt --config /etc/caddy/Caddyfile --pretty >/dev/null

echo "GDNS Caddy config check passed"
