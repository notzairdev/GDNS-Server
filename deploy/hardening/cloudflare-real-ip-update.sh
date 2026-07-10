#!/usr/bin/env bash
set -euo pipefail

TARGET="/etc/nginx/conf.d/00-cloudflare-real-ip.conf"
cidrs="$(mktemp)"
candidate="$(mktemp)"
backup="$(mktemp)"

# Invoked indirectly by the EXIT trap.
# shellcheck disable=SC2317
cleanup() {
  rm -f "$cidrs" "$candidate" "$backup"
}
trap cleanup EXIT

curl --fail --silent --show-error --proto '=https' --tlsv1.2 \
  https://www.cloudflare.com/ips-v4 > "$cidrs"
printf '\n' >> "$cidrs"
curl --fail --silent --show-error --proto '=https' --tlsv1.2 \
  https://www.cloudflare.com/ips-v6 >> "$cidrs"

python3 - "$cidrs" "$candidate" <<'PY'
import ipaddress
import pathlib
import sys

source = pathlib.Path(sys.argv[1])
target = pathlib.Path(sys.argv[2])
networks = []

for raw_line in source.read_text(encoding="ascii").splitlines():
    line = raw_line.strip()
    if line:
        networks.append(ipaddress.ip_network(line, strict=True))

v4_count = sum(network.version == 4 for network in networks)
v6_count = sum(network.version == 6 for network in networks)
if v4_count < 10 or v6_count < 5:
    raise SystemExit("Cloudflare CIDR response did not pass sanity checks")

unique = sorted(set(networks), key=lambda network: (network.version, int(network.network_address)))
lines = ["# Managed by update-cloudflare-real-ips.\n"]
lines.extend(f"set_real_ip_from {network};\n" for network in unique)
lines.extend(("real_ip_header CF-Connecting-IP;\n", "real_ip_recursive on;\n"))
target.write_text("".join(lines), encoding="ascii")
PY

if [ -f "$TARGET" ] && cmp -s "$candidate" "$TARGET"; then
  echo "Cloudflare real IP ranges already current"
  exit 0
fi

had_target=0
if [ -f "$TARGET" ]; then
  cp -a "$TARGET" "$backup"
  had_target=1
fi

install -m 0644 "$candidate" "$TARGET"
if nginx -t; then
  systemctl reload nginx.service
  echo "Cloudflare real IP ranges updated"
  exit 0
fi

if [ "$had_target" -eq 1 ]; then
  cp -a "$backup" "$TARGET"
else
  rm -f "$TARGET"
fi
nginx -t
systemctl reload nginx.service
echo "Cloudflare real IP update failed; previous config restored" >&2
exit 1
