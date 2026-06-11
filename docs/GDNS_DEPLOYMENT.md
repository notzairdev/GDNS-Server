# GDNS Deployment

## Goal

The first production milestone is a healthy single-node deployment on one
Always Free Ampere VM. Custom product behavior comes after this baseline is
boring: containers start, certs renew, healthchecks pass, and backups exist.

## VM Bootstrap

On a fresh Ubuntu VM, copy or paste the bootstrap script and run:

```bash
sudo APP_DIR=/opt/gdns bash deploy/scripts/bootstrap-ubuntu.sh
```

Firewall defaults stay conservative. To also configure UFW on the host:

```bash
sudo CONFIGURE_UFW=1 APP_DIR=/opt/gdns bash deploy/scripts/bootstrap-ubuntu.sh
```

OCI Security Lists or Network Security Groups must still allow only:

```text
22/tcp, 53/tcp, 53/udp, 80/tcp, 443/tcp, 443/udp, 853/tcp, 784/udp
```

## DNS Records

Point these Cloudflare records to the VM public IP:

```text
dns.<DNS_DOMAIN>      A/AAAA  <VM_PUBLIC_IP>
*.dns.<DNS_DOMAIN>    A/AAAA  <VM_PUBLIC_IP>
<DNS_DOMAIN>          A/AAAA  <VM_PUBLIC_IP>
```

The wildcard record is required for profile hosts such as
`abc123.dns.<DNS_DOMAIN>`.

## GitHub Secrets

`GDNS Deploy` needs:

- `VM_HOST`: VM public IP or hostname.
- `VM_PORT`: SSH port, optional; defaults to `22`.
- `VM_USER`: SSH username, usually `ubuntu`.
- `VM_SSH_KEY`: private SSH key for the VM.
- `GHCR_TOKEN`: GitHub PAT with `read:packages` if GHCR packages are private.
- `PROD_ENV_FILE`: full production env file content.

Start from [deploy/env.prod.example](../deploy/env.prod.example) for
`PROD_ENV_FILE`.

`GDNS Blocklists Sync` also needs:

- `API_BASE_URL`: `https://<DNS_DOMAIN>`.
- `API_SECRET`: same value as production.

`GDNS Maintenance` reuses the VM SSH secrets and runs weekly backup, cert
renewal, healthcheck, and image pruning.

## First Deploy

Before the first deploy, validate the production env from the repo root or
from `/opt/gdns` after the bundle exists there:

```bash
cd /opt/gdns
ENV_FILE=.env ./deploy/scripts/preflight.sh
ENV_FILE=.env ./deploy/scripts/caddy-check.sh
```

1. Run `GDNS Images` on the branch or wait for it after push.
2. Run `GDNS Deploy` with `image_tag=latest`.
3. The workflow uploads the compose bundle to `/opt/gdns`, writes `.env`, logs
   in to GHCR when `GHCR_TOKEN` is set, issues the wildcard DoT certificate via
   Certbot DNS-Cloudflare, starts the stack, then runs healthchecks.

The production compose file uses:

- `certbot` profile for `dns.<DNS_DOMAIN>` and `*.dns.<DNS_DOMAIN>`.
- `AdGuardHome` on `53/tcp`, `53/udp`, `853/tcp`, and `784/udp`.
- `Caddy` on `80/tcp`, `443/tcp`, and `443/udp`.
- `Profile API` internally on `4000`.
- Deterministic compose project name `gdns` for stable volume names.

## Operations

Healthcheck:

```bash
cd /opt/gdns
./deploy/scripts/healthcheck.sh
```

Renew AGH DoT certs:

```bash
cd /opt/gdns
./deploy/scripts/renew-certs.sh
```

Backup SQLite and AGH config:

```bash
cd /opt/gdns
./deploy/scripts/backup.sh
```

Backups are written under `/opt/gdns/backups` and retained for 14 days by
default. Override retention with `RETENTION_DAYS=30`.

## Current Boundary

This deployment path assumes the VM already exists and is reachable by SSH. OCI
CLI automation for creating or inspecting cloud resources is intentionally left
for the next step, when credentials are actually needed.
