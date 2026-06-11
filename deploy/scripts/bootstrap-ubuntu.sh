#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/gdns}"
CONFIGURE_UFW="${CONFIGURE_UFW:-0}"

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  SUDO="sudo"
fi

$SUDO apt-get update
$SUDO apt-get install -y ca-certificates curl docker.io docker-compose-plugin ufw
$SUDO systemctl enable --now docker
$SUDO mkdir -p "$APP_DIR" "$APP_DIR/backups" "$APP_DIR/certs"
$SUDO chown -R "${SUDO_USER:-$USER}:${SUDO_USER:-$USER}" "$APP_DIR"

if [ "$CONFIGURE_UFW" = "1" ]; then
  $SUDO ufw allow 22/tcp
  $SUDO ufw allow 53/tcp
  $SUDO ufw allow 53/udp
  $SUDO ufw allow 80/tcp
  $SUDO ufw allow 443/tcp
  $SUDO ufw allow 443/udp
  $SUDO ufw allow 853/tcp
  $SUDO ufw allow 784/udp
  $SUDO ufw --force enable
fi

if [ -n "${SUDO_USER:-}" ]; then
  $SUDO usermod -aG docker "$SUDO_USER" || true
fi

echo "GDNS bootstrap complete at $APP_DIR"
