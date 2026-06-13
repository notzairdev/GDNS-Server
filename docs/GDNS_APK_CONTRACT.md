# GDNS APK Contract

This server-side contract is the stable boundary for the Android failover app.
It does not expose admin credentials, filter contents, query logs, or profile
lists.

## Heartbeat

```http
GET /apk/heartbeat/{profile_id}
```

The endpoint is public because the APK needs it before an admin session exists.
It only accepts a concrete profile ID and returns `404` for unknown profiles.
Responses are sent with `Cache-Control: no-store`.

Example:

```json
{
  "ok": true,
  "service": "gdns-profile-api",
  "profile": {
    "id": "abc123",
    "active": true,
    "updated_at": 1781375000000
  },
  "failover": {
    "available": true,
    "reason": null,
    "primary_private_dns": "abc123.dns.nextdns.io",
    "fallback_private_dns": "abc123.dns.gdns.goat-tool.com",
    "fallback_doh": "https://abc123.dns.gdns.goat-tool.com/dns-query",
    "fallback_doh_path": "https://dns.gdns.goat-tool.com/dns-query/abc123"
  },
  "heartbeat": {
    "interval_ms": 30000,
    "timeout_ms": 5000,
    "failure_threshold": 3,
    "restore_threshold": 2,
    "backoff_ms": [5000, 15000, 30000, 60000, 120000],
    "checked_at": 1781375000000
  }
}
```

## APK State Machine

- `NORMAL`: Android Private DNS points to `primary_private_dns`.
- `VERIFYING_FAILOVER`: NextDNS heartbeat has failed; re-check with exponential
  backoff before changing DNS.
- `FAILOVER_ACTIVE`: Device Owner applies `fallback_private_dns`.
- `RESTORING`: NextDNS has recovered for `restore_threshold` consecutive checks;
  Device Owner switches back to `primary_private_dns`.

The APK should treat `failover.available: false` as a hard stop and surface the
`reason` to the administrator.

## Provisioning From The C# Agent

After the agent creates the profile in NextDNS, it should call GDNS with the
same profile ID and the matching GDNS template:

```http
POST /api/apk/provision
Authorization: Bearer {API_SECRET}
Content-Type: application/json
```

```json
{
  "profile_id": "abc123",
  "name": "Pixel 8",
  "device_name": "Pixel 8",
  "template_id": "no_social",
  "nextdns_private_dns": "abc123.dns.nextdns.io"
}
```

The endpoint is idempotent. It creates the GDNS profile when missing and updates
it when it already exists, always applying the selected server-side template.

Response shape:

```json
{
  "provisioning": {
    "action": "created",
    "profile_id": "abc123",
    "template_id": "no_social",
    "template_name": "Sin redes"
  },
  "nextdns": {
    "private_dns": "abc123.dns.nextdns.io"
  },
  "credentials": {
    "profile_id": "abc123",
    "dot": "abc123.dns.gdns.goat-tool.com",
    "doh": "https://abc123.dns.gdns.goat-tool.com/dns-query",
    "doh_path": "https://dns.gdns.goat-tool.com/dns-query/abc123",
    "plain_dns": null
  },
  "apk": {
    "setup_uri": "gdns://profile?...",
    "failover": {
      "primary_private_dns": "abc123.dns.nextdns.io",
      "fallback_private_dns": "abc123.dns.gdns.goat-tool.com"
    },
    "switching": {
      "blackhole_required": true,
      "restore_requires_positive_primary": true,
      "device_owner_required": true
    }
  }
}
```

Recommended C# flow:

1. Create or update the NextDNS profile using the agent's existing template
   mapping.
2. Call `/api/apk/provision` with the NextDNS profile ID and matching
   `template_id`.
3. Install the APK with ADB.
4. Pass `apk.setup_uri` or the parsed `nextdns.private_dns` +
   `credentials.dot` pair into the APK.
5. Grant Device Owner and let the APK persist both DNS hosts locally.
