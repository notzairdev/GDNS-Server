# GDNS Phase 0 Foundation

## Summary

This fork is the AdGuardHome root, not a monorepo with an `adguardhome/`
submodule. Phase 0 keeps the fork at the root and adds the operational shell
around it: Docker Compose, Caddy, a minimal Profile API scaffold, and an
AdGuardHome configuration template aligned with Android Private DNS.

## Architecture Defaults

- Android Private DNS uses DoT, so production exposes AdGuardHome directly on
  `853/tcp`. Caddy only handles HTTPS, DoH reverse proxying, `/api/*`, and the
  protected AdGuardHome dashboard at `/agh/*`.
- AdGuardHome already supports ClientID from DoT/DoQ server names and DoH path
  values. Profile hosts use `{profileId}.dns.${DNS_DOMAIN}`.
- Profile IDs are lowercase DNS-label-safe values. They are stored as AGH
  client IDs through `ids: [profileId]`.
- AGH filtering rules can use `$client=...`, but AGH matches that condition
  against the client name. The API therefore creates the AGH client with
  `name = profileId`; human-friendly device labels stay in SQLite.
- DoT requires a wildcard certificate valid for `*.dns.${DNS_DOMAIN}`.
  Production issues this with the `certbot` compose profile and mounts it into
  AdGuardHome read-only.
- `GDNS Images` publishes `gdns-adguardhome`, `gdns-api`, and `gdns-caddy` to
  GHCR for `linux/amd64` and `linux/arm64`.

## Always Free OCI Shape

Use one active Ampere A1 VM with 2 OCPU and 6 GB RAM for the MVP. Keep the
second 2 OCPU / 6 GB allocation as standby until we have health checks and a
real failover story. This stays under the Always Free Ampere A1 pool and avoids
splitting DNS state before the SQLite/API backup flow exists.

## Local Bootstrap

1. Copy `.env.example` to `.env` and fill real values.
   Keep bcrypt hashes wrapped in single quotes so Docker Compose does not
   interpolate `$`.
2. Place wildcard cert files in `runtime/certs/fullchain.pem` and
   `runtime/certs/privkey.pem`.
3. Start the stack with `docker compose up --build`.
4. Optionally refresh blocklists:

```bash
curl -X POST http://localhost:4000/api/blocklists/refresh \
  -H "Authorization: Bearer $API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{}'
```

5. Create the first profile:

```bash
curl -X POST http://localhost:4000/api/profiles \
  -H "Authorization: Bearer $API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"id":"nextdns-profile-id","name":"Pixel 8","device_name":"Pixel 8"}'
```

Generate bcrypt hashes with:

```bash
docker run --rm caddy:2-alpine caddy hash-password --plaintext "your-password"
```

## Production Bootstrap

1. Create one OCI Ampere A1 VM: 2 OCPU, 6 GB RAM, Ubuntu 22.04/24.04 ARM64.
2. Open ingress only for `22/tcp`, `53/tcp`, `53/udp`, `80/tcp`, `443/tcp`,
   `443/udp`, `853/tcp`, and optionally `784/udp`.
3. Point `dns.${DNS_DOMAIN}` and `*.dns.${DNS_DOMAIN}` to the VM public IP.
4. Add the GitHub secrets described in
   [GDNS_DEPLOYMENT.md](GDNS_DEPLOYMENT.md).
5. Run the `GDNS Deploy` workflow.

## Known Phase 0 Gaps

- Certificate renewal for AGH DoT is available through
  `deploy/scripts/renew-certs.sh`. A scheduled remote maintenance workflow can
  be added after the first successful deploy.
- The Profile API now has profile CRUD, category selection, manual rules,
  blocklist refresh, and AGH managed-rule sync. It is still intentionally small:
  there is no dashboard UI yet and no pagination/search around logs.
- OCI automation is not wired yet; credentials are not needed until we create
  or inspect cloud resources.
