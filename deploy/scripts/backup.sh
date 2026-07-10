#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
BACKUP_DIR="${BACKUP_DIR:-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_FILE="$BACKUP_DIR/gdns-${STAMP}.tgz"

compose=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

umask 077
install -d -m 0700 "$BACKUP_DIR"

"${compose[@]}" exec -T api node -e "const Database=require('better-sqlite3'); const db=new Database('/app/data/profiles.db'); db.pragma('wal_checkpoint(TRUNCATE)'); db.close();" </dev/null

docker run --rm \
  -v gdns_api_data:/volumes/api_data:ro \
  -v gdns_agh_conf:/volumes/agh_conf:ro \
  -v "$(pwd)/$BACKUP_DIR:/backups" \
  alpine:3.20 \
  sh -ceu '
    backup="$1"
    trap '\''rm -f "$backup"'\'' EXIT
    umask 077
    tar -czf "$backup" -C /volumes api_data agh_conf
    tar -tzf "$backup" >/dev/null
    find /backups -maxdepth 1 -type f -name '\''gdns-*.tgz'\'' -exec chmod 600 {} +
    trap - EXIT
  ' sh "/backups/gdns-${STAMP}.tgz"

find "$BACKUP_DIR" -name 'gdns-*.tgz' -type f -mtime +"$RETENTION_DAYS" -delete

echo "$BACKUP_FILE"
