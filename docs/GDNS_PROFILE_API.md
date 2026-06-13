# GDNS Profile API

## Purpose

The Profile API owns personal profile metadata in SQLite and keeps AdGuardHome
aligned through its REST API. Profile IDs must match the corresponding NextDNS
profile IDs so Android failover can switch hosts without changing identity.

## Authentication

`/health` is public for heartbeat checks. Every `/api/*` route requires:

```http
Authorization: Bearer <API_SECRET>
```

If `API_SECRET` is empty, auth is bypassed for local development.

## Profiles

Create:

```bash
curl -X POST "$API_BASE_URL/api/profiles" \
  -H "Authorization: Bearer $API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "nextdns-profile-id",
    "name": "Pixel 8",
    "device_name": "Pixel 8",
    "categories": ["ads", "malware"],
    "rules": [
      { "type": "block", "rule": "||example.org^" },
      { "type": "allow", "rule": "||safe.example.org^" }
    ]
  }'
```

Update:

```bash
curl -X PUT "$API_BASE_URL/api/profiles/nextdns-profile-id" \
  -H "Authorization: Bearer $API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{ "active": true, "categories": { "ads": true, "social_media": false } }'
```

Sync:

```bash
curl -X POST "$API_BASE_URL/api/profiles/nextdns-profile-id/sync" \
  -H "Authorization: Bearer $API_SECRET"
```

Credentials:

```bash
curl "$API_BASE_URL/api/profiles/nextdns-profile-id/credentials" \
  -H "Authorization: Bearer $API_SECRET"
```

Logs:

```bash
curl "$API_BASE_URL/api/profiles/nextdns-profile-id/logs?limit=120" \
  -H "Authorization: Bearer $API_SECRET"
```

The logs endpoint reads the AdGuardHome query log and returns entries whose
client name matches the profile ID. Entries are normalized as `allowed` or
`blocked` with the matching rule or blocked service when AdGuardHome reports it.

## Blocklists

Categories are defined in `api/src/blocklists/categories.json`. Remote list
rules are cached in SQLite by `POST /api/blocklists/refresh`. Profile sync then
expands enabled categories into AdGuardHome profile filter rules with
`$client=<profile>`.

Categories can also map to native AdGuardHome `blocked_services`. The
`social_media` category uses this for Facebook, Instagram, TikTok, and X so the
profile gets AdGuardHome's maintained service-domain catalog instead of only a
small hand-written domain list.

The managed AGH rule block is wrapped with:

```text
# gdns:managed:start
# gdns:profile:<profile-id>
...
# gdns:managed:end
```

Rules outside that managed block are preserved.

## GitHub Secrets

`GDNS Blocklists Sync` needs these repository secrets after the API is deployed:

- `API_BASE_URL`, for example `https://example.com`
- `API_SECRET`, matching the production `.env`

## Status

`GET /api/status` returns the operational status behind Bearer auth:

```bash
curl "$API_BASE_URL/api/status" \
  -H "Authorization: Bearer $API_SECRET"
```

It reports SQLite counts, AdGuardHome API connectivity, cached blocklist count,
and the latest sync error when one exists. A healthy response uses HTTP `200`;
a degraded AdGuardHome connection uses HTTP `503`.

## Dashboard

The root domain serves the React/Vite dashboard build from Caddy. The console
exchanges `API_SECRET` for a signed, `HttpOnly`, `SameSite=Strict` session
cookie, then calls the same protected API routes documented here. No profile
data is embedded in the static assets.
