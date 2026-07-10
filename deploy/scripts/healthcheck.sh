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
"${compose[@]}" exec -T api node -e "fetch('http://127.0.0.1:4000/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" </dev/null

echo "== AdGuardHome HTTP health =="
"${compose[@]}" exec -T adguardhome wget -q -O /dev/null http://127.0.0.1:3000/ </dev/null

echo "== Caddy config health =="
"${compose[@]}" exec -T caddy caddy validate --config /etc/caddy/Caddyfile </dev/null

dns_domain="$(
  docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' gdns-caddy |
    sed -n 's/^DNS_DOMAIN=//p'
)"
https_port="$(docker port gdns-caddy 443/tcp | sed -n '1{s/.*://;p;}')"
dot_endpoint="$(docker port gdns-adguardhome 853/tcp | sed -n '1p')"

if [ -z "$dns_domain" ] || [ -z "$https_port" ] || [ -z "$dot_endpoint" ]; then
  echo "Unable to determine public TLS endpoints" >&2
  exit 1
fi

echo "== HTTPS route health =="
curl --fail --silent --show-error --max-time 10 \
  --resolve "${dns_domain}:${https_port}:127.0.0.1" \
  "https://${dns_domain}:${https_port}/health" >/dev/null

echo "== DNS-over-TLS health =="
dot_sni="healthcheck.dns.${dns_domain}"
timeout 10 openssl s_client \
  -brief \
  -verify_return_error \
  -verify_hostname "$dot_sni" \
  -connect "$dot_endpoint" \
  -servername "$dot_sni" \
  </dev/null >/dev/null 2>&1

echo "GDNS healthcheck passed"
