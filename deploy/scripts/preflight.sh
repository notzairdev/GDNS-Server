#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"

required_vars="
DNS_DOMAIN
ACME_EMAIL
CF_API_TOKEN
AGH_USER
AGH_PASS
AGH_PASS_HASH
API_SECRET
DASHBOARD_USER
DASHBOARD_PASS_HASH
"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

fail=0
for name in $required_vars; do
  value="$(printenv "$name" || true)"
  if [ -z "$value" ]; then
    echo "Missing required env var: $name" >&2
    fail=1
    continue
  fi

  normalized_value="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"
  case "$normalized_value" in
    *replace_with*|*example.com*|*cloudflare_token*|*change_me*|*placeholder*)
      echo "Placeholder value still present in: $name" >&2
      fail=1
      ;;
  esac
done

case "${DNS_DOMAIN:-}" in
  http://*|https://*|*/*|*:*|.*|*.)
    echo "DNS_DOMAIN must be a bare domain, for example example.com" >&2
    fail=1
    ;;
esac

case "${AGH_PASS_HASH:-}" in
  "\$2"*|"\\\$2"*) ;;
  *)
    echo "AGH_PASS_HASH should be a bcrypt hash and remain quoted in .env" >&2
    fail=1
    ;;
esac

case "${DASHBOARD_PASS_HASH:-}" in
  "\$2"*|"\\\$2"*) ;;
  *)
    echo "DASHBOARD_PASS_HASH should be a Caddy bcrypt hash and remain quoted in .env" >&2
    fail=1
    ;;
esac

if [ "$fail" -ne 0 ]; then
  exit 1
fi

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config --quiet
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" --profile certs config --quiet

echo "GDNS preflight passed"
