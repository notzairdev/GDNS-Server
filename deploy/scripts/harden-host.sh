#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this script as root" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HARDENING_DIR="$ROOT_DIR/deploy/hardening"
APPLY_UPGRADES="${APPLY_UPGRADES:-0}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="/root/gdns-hardening/$STAMP"

for file in \
  sshd.conf \
  fail2ban.conf \
  journald.conf \
  sysctl.conf \
  audit.rules \
  limits.conf \
  coredump.conf \
  nginx-wordpress-rate-limit.conf \
  cloudflare-real-ip-update.sh \
  cloudflare-real-ip-update.service \
  cloudflare-real-ip-update.timer \
  gdns-docker-firewall.sh \
  gdns-docker-firewall.service \
  docker-gdns-firewall.conf \
  unattended-upgrades.conf; do
  if [ ! -f "$HARDENING_DIR/$file" ]; then
    echo "Missing hardening file: $HARDENING_DIR/$file" >&2
    exit 1
  fi
done

install -d -m 0700 "$BACKUP_DIR"
for path in \
  /etc/ssh/sshd_config.d \
  /etc/fail2ban/jail.d \
  /etc/systemd/journald.conf.d \
  /etc/sysctl.d \
  /etc/audit/rules.d \
  /etc/security/limits.d \
  /etc/systemd/coredump.conf.d \
  /etc/apt/apt.conf.d \
  /etc/ufw \
  /etc/iptables \
  /etc/nginx \
  "$ROOT_DIR/docker-compose.prod.yml" \
  "$ROOT_DIR/caddy/Caddyfile"; do
  if [ -e "$path" ]; then
    cp -a --parents "$path" "$BACKUP_DIR"
  fi
done

export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a
apt-get update
apt-get install -y auditd audispd-plugins apparmor-utils debsums needrestart

if [ "$APPLY_UPGRADES" = "1" ]; then
  apt-get upgrade -y
fi

install -m 0644 "$HARDENING_DIR/sshd.conf" \
  /etc/ssh/sshd_config.d/00-gdns-hardening.conf
rm -f /etc/ssh/sshd_config.d/99-gdns-hardening.conf
sshd -t
systemctl reload ssh.service

install -m 0644 "$HARDENING_DIR/fail2ban.conf" \
  /etc/fail2ban/jail.d/sshd-gdns.conf
fail2ban-client -t
systemctl enable --now fail2ban.service
systemctl restart fail2ban.service

install -d -m 0755 /etc/systemd/journald.conf.d
install -m 0644 "$HARDENING_DIR/journald.conf" \
  /etc/systemd/journald.conf.d/60-gdns-limits.conf
systemctl restart systemd-journald.service
journalctl --vacuum-time=30d --vacuum-size=512M >/dev/null

install -m 0644 "$HARDENING_DIR/sysctl.conf" \
  /etc/sysctl.d/99-gdns-hardening.conf
sysctl --system >/dev/null

install -d -m 0755 /etc/security/limits.d /etc/systemd/coredump.conf.d
install -m 0644 "$HARDENING_DIR/limits.conf" \
  /etc/security/limits.d/99-gdns-hardening.conf
install -m 0644 "$HARDENING_DIR/coredump.conf" \
  /etc/systemd/coredump.conf.d/60-gdns-hardening.conf

install -m 0640 "$HARDENING_DIR/audit.rules" \
  /etc/audit/rules.d/60-gdns.rules
systemctl enable --now auditd.service
augenrules --load

install -m 0644 "$HARDENING_DIR/unattended-upgrades.conf" \
  /etc/apt/apt.conf.d/60-gdns-hardening

if command -v nginx >/dev/null 2>&1; then
  restore_nginx_config() {
    cp -a "$BACKUP_DIR/etc/nginx/nginx.conf" /etc/nginx/nginx.conf
    for managed_file in \
      00-cloudflare-real-ip.conf \
      10-wordpress-rate-limit.conf; do
      if [ -f "$BACKUP_DIR/etc/nginx/conf.d/$managed_file" ]; then
        cp -a "$BACKUP_DIR/etc/nginx/conf.d/$managed_file" \
          "/etc/nginx/conf.d/$managed_file"
      else
        rm -f "/etc/nginx/conf.d/$managed_file"
      fi
    done
  }

  install -m 0644 "$HARDENING_DIR/nginx-wordpress-rate-limit.conf" \
    /etc/nginx/conf.d/10-wordpress-rate-limit.conf
  install -m 0755 "$HARDENING_DIR/cloudflare-real-ip-update.sh" \
    /usr/local/sbin/update-cloudflare-real-ips
  install -m 0644 "$HARDENING_DIR/cloudflare-real-ip-update.service" \
    /etc/systemd/system/cloudflare-real-ip-update.service
  install -m 0644 "$HARDENING_DIR/cloudflare-real-ip-update.timer" \
    /etc/systemd/system/cloudflare-real-ip-update.timer

  sed -i -E \
    's/^[[:space:]]*ssl_protocols[[:space:]].*;/\tssl_protocols TLSv1.2 TLSv1.3;/' \
    /etc/nginx/nginx.conf
  if ! nginx -t || ! systemctl reload nginx.service; then
    restore_nginx_config
    nginx -t
    systemctl reload nginx.service
    echo "Nginx hardening failed; previous config restored" >&2
    exit 1
  fi
fi

install -m 0755 "$HARDENING_DIR/gdns-docker-firewall.sh" \
  /usr/local/sbin/gdns-docker-firewall
install -m 0644 "$HARDENING_DIR/gdns-docker-firewall.service" \
  /etc/systemd/system/gdns-docker-firewall.service
install -d -m 0755 /etc/systemd/system/docker.service.d
install -m 0644 "$HARDENING_DIR/docker-gdns-firewall.conf" \
  /etc/systemd/system/docker.service.d/50-gdns-firewall.conf
systemctl daemon-reload
systemctl enable --now gdns-docker-firewall.service

if command -v nginx >/dev/null 2>&1; then
  /usr/local/sbin/update-cloudflare-real-ips
  systemctl enable --now cloudflare-real-ip-update.timer
fi

if ufw status | grep -qE '^8088/tcp[[:space:]]'; then
  ufw --force delete allow 8088/tcp
fi
if ufw status | grep -qE '^53/tcp[[:space:]]'; then
  ufw --force delete allow 53/tcp
fi
if ufw status | grep -qE '^53/udp[[:space:]]'; then
  ufw --force delete allow 53/udp
fi

chmod -R go-w "$ROOT_DIR"
chmod 600 "$ROOT_DIR/.env"
find "$ROOT_DIR/deploy/scripts" -type f -name '*.sh' -exec chmod 755 {} +

world_writable="$(
  find "$ROOT_DIR" -xdev \( -type f -o -type d \) -perm -0002 | wc -l
)"
if [ "$world_writable" -ne 0 ]; then
  echo "World-writable GDNS files or directories remain: $world_writable" >&2
  exit 1
fi

echo "GDNS host hardening applied"
echo "Rollback copy: $BACKUP_DIR"
