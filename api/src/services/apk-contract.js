export const heartbeatDefaults = {
  interval_ms: 1000,
  timeout_ms: 1200,
  failure_threshold: 2,
  restore_threshold: 3,
  backoff_ms: [250, 500, 1000, 2000, 5000, 10000],
};

export function nextDnsPrivateDns(profileId, override = null) {
  if (override) {
    return override;
  }

  const domain = process.env.NEXTDNS_DOT_DOMAIN || 'dns.nextdns.io';
  return `${profileId}.${domain}`;
}

export function heartbeatPath(profileId) {
  return `/apk/heartbeat/${profileId}`;
}

export function publicUrl(request, path) {
  const configured = process.env.PUBLIC_BASE_URL;
  if (configured) {
    return `${configured.replace(/\/$/, '')}${path}`;
  }

  const host = request?.headers?.['x-forwarded-host'] || request?.headers?.host;
  if (!host) {
    return path;
  }

  const proto = String(request?.headers?.['x-forwarded-proto'] || 'https').split(',')[0].trim();
  return `${proto}://${host}${path}`;
}

export function apkSetupUri({
  profileId,
  credentials,
  primaryPrivateDns = null,
  heartbeat = heartbeatPath(profileId),
  heartbeatPath: heartbeatPathValue = heartbeatPath(profileId),
}) {
  const params = new URLSearchParams({
    v: '1',
    profile_id: profileId,
    nextdns_dot: nextDnsPrivateDns(profileId, primaryPrivateDns),
    gdns_dot: credentials.dot,
    gdns_doh: credentials.doh,
    gdns_doh_path: credentials.doh_path,
    heartbeat,
    heartbeat_path: heartbeatPathValue,
  });

  return `gdns://profile?${params.toString()}`;
}

export function apkRuntimeContract({
  profile,
  credentials,
  request = null,
  primaryPrivateDns = null,
}) {
  const path = heartbeatPath(profile.id);
  const url = publicUrl(request, path);
  const nextDns = nextDnsPrivateDns(profile.id, primaryPrivateDns);

  return {
    profile: {
      id: profile.id,
      active: Boolean(profile.active),
      updated_at: profile.updated_at,
    },
    failover: {
      available: Boolean(profile.active),
      reason: profile.active ? null : 'profile_disabled',
      primary_private_dns: nextDns,
      fallback_private_dns: credentials.dot,
      fallback_doh: credentials.doh,
      fallback_doh_path: credentials.doh_path,
    },
    heartbeat: {
      ...heartbeatDefaults,
      path,
      url,
      checked_at: Date.now(),
    },
    switching: {
      blackhole_required: true,
      restore_requires_positive_primary: true,
      device_owner_required: true,
    },
    setup_uri: apkSetupUri({
      profileId: profile.id,
      credentials,
      primaryPrivateDns: nextDns,
      heartbeat: url,
      heartbeatPath: path,
    }),
  };
}
