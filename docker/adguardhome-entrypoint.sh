#!/bin/sh
set -eu

conf_path="/opt/adguardhome/conf/AdGuardHome.yaml"
template_path="/opt/adguardhome/templates/AdGuardHome.yaml.tmpl"

if [ ! -s "$conf_path" ]; then
	: "${DNS_DOMAIN:?DNS_DOMAIN is required}"
	: "${AGH_USER:?AGH_USER is required}"
	: "${AGH_PASS_HASH:?AGH_PASS_HASH is required}"
	: "${AGH_TLS_CERT_PATH:=/opt/adguardhome/certs/fullchain.pem}"
	: "${AGH_TLS_KEY_PATH:=/opt/adguardhome/certs/privkey.pem}"

	envsubst < "$template_path" > "$conf_path"
fi

exec /opt/adguardhome/AdGuardHome "$@"
