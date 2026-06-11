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

## Blocklists

Categories are defined in `api/src/blocklists/categories.json`. Remote list
rules are cached in SQLite by `POST /api/blocklists/refresh`. Profile sync then
expands enabled categories into AdGuardHome user rules with `$client=<profile>`.

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
