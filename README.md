# GDNS-Server

GDNS-Server is a tailored fork of [AdGuard Home](https://github.com/AdguardTeam/AdGuardHome), designed to provide an API-driven, Android Private DNS-aligned deployment model. It incorporates an operational shell consisting of Docker Compose, Caddy, a Profile API, and a custom Dashboard.

## Architecture & Defaults

*   **DNS-over-TLS (DoT):** Android Private DNS exclusively uses DoT. The production environment exposes AdGuardHome directly on `853/tcp`.
*   **Caddy Integration:** Caddy handles HTTPS, DoH reverse proxying, API routes (`/api/*`), and protects the AdGuardHome administrative dashboard at `/agh/*`.
*   **Profile API:** Provides endpoints for managing profiles. Profiles map lowercase, DNS-label-safe IDs to AdGuardHome clients. Users connect using `{profileId}.dns.${DNS_DOMAIN}`.
*   **Docker Compose:** The primary deployment structure runs `gdns-adguardhome`, `gdns-api`, and `gdns-caddy` containers.

## Getting Started

### Local Bootstrap

1.  Copy `.env.example` to `.env` and configure your variables. Make sure bcrypt hashes are wrapped in single quotes so Docker Compose does not interpolate `$`.
2.  Place wildcard certificates in `runtime/certs/fullchain.pem` and `runtime/certs/privkey.pem`.
3.  Start the stack:
    ```bash
    docker compose up --build
    ```
4.  Optionally, trigger a blocklist refresh:
    ```bash
    curl -X POST http://localhost:4000/api/blocklists/refresh \
      -H "Authorization: Bearer $API_SECRET" \
      -H "Content-Type: application/json" \
      -d '{}'
    ```
5.  Create your first profile via the Profile API:
    ```bash
    curl -X POST http://localhost:4000/api/profiles \
      -H "Authorization: Bearer $API_SECRET" \
      -H "Content-Type: application/json" \
      -d '{"id":"nextdns-profile-id","name":"Pixel 8","device_name":"Pixel 8"}'
    ```

### Production Deployment

GDNS-Server is designed to be deployed to an Always Free Oracle Cloud Infrastructure (OCI) Ampere VM. 

Deployment is automated via GitHub Actions (`GDNS Deploy`). Please refer to the following guides for detailed instructions:

*   [GDNS Phase 0 Foundation](docs/GDNS_PHASE_0.md)
*   [GDNS Deployment Guide](docs/GDNS_DEPLOYMENT.md)

## Operations

Scripts are provided in the `deploy/scripts/` directory for standard operational tasks:

*   **Healthcheck:** `./deploy/scripts/healthcheck.sh`
*   **Renew DoT Certificates:** `./deploy/scripts/renew-certs.sh`
*   **Backups (SQLite & Configuration):** `./deploy/scripts/backup.sh`

## Documentation

See the [docs/](docs/) folder for detailed architecture, deployment, and API design documents.

## License

This project includes code derived from [AdGuard Home](https://github.com/AdguardTeam/AdGuardHome). See [LICENSE.txt](LICENSE.txt) for license details.
