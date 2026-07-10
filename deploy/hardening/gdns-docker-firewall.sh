#!/usr/bin/env bash
set -euo pipefail

iptables_bin="$(command -v iptables)"
external_interface="${EXTERNAL_INTERFACE:-$(ip -4 route show default | awk 'NR == 1 {print $5}')}"

if [ -z "$external_interface" ]; then
  echo "Unable to determine the external network interface" >&2
  exit 1
fi

if ! "$iptables_bin" -nL DOCKER-USER >/dev/null 2>&1; then
  echo "Docker DOCKER-USER chain is not available" >&2
  exit 1
fi

delete_all() {
  while "$iptables_bin" -C DOCKER-USER "$@" >/dev/null 2>&1; do
    "$iptables_bin" -D DOCKER-USER "$@"
  done
}

# Remove the old broad rules that also blocked encrypted DNS transports.
delete_all -p udp --dport 784 -j DROP
delete_all -p tcp --dport 853 -j DROP
delete_all -p tcp --dport 53 -j DROP
delete_all -p udp --dport 53 -j DROP

while rule_number="$(
  "$iptables_bin" -nL DOCKER-USER --line-numbers |
    awk '/gdns-block-plain-dns/ {print $1; exit}'
)" && [ -n "$rule_number" ]; do
  "$iptables_bin" -D DOCKER-USER "$rule_number"
done

# Docker-published ports bypass UFW.  Block only unencrypted public DNS here.
"$iptables_bin" -I DOCKER-USER 1 -i "$external_interface" -p tcp --dport 53 \
  -m comment --comment gdns-block-plain-dns-tcp -j DROP
"$iptables_bin" -I DOCKER-USER 1 -i "$external_interface" -p udp --dport 53 \
  -m comment --comment gdns-block-plain-dns-udp -j DROP
