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
