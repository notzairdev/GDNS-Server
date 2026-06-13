import { getDb } from '../db/client.js';
import { credentialsFor, profileIdPattern } from './profiles.js';

const heartbeatDefaults = {
  interval_ms: 30000,
  timeout_ms: 5000,
  failure_threshold: 3,
  restore_threshold: 2,
  backoff_ms: [5000, 15000, 30000, 60000, 120000],
};

function nextDnsHost(profileId) {
  const domain = process.env.NEXTDNS_DOT_DOMAIN || 'dns.nextdns.io';
  return `${profileId}.${domain}`;
}

export function registerApkRoutes(app) {
  app.get('/apk/heartbeat/:id', async (request, reply) => {
    const profileId = String(request.params.id || '').trim().toLowerCase();

    reply.header('cache-control', 'no-store');

    if (!profileIdPattern.test(profileId)) {
      return reply.status(400).send({
        ok: false,
        error: 'invalid_profile_id',
      });
    }

    const profile = getDb()
      .prepare('SELECT id, active, updated_at FROM profiles WHERE id = ?')
      .get(profileId);

    if (!profile) {
      return reply.status(404).send({
        ok: false,
        error: 'profile_not_found',
      });
    }

    const credentials = credentialsFor(profile.id);

    return {
      ok: true,
      service: 'gdns-profile-api',
      profile: {
        id: profile.id,
        active: Boolean(profile.active),
        updated_at: profile.updated_at,
      },
      failover: {
        available: Boolean(profile.active),
        reason: profile.active ? null : 'profile_disabled',
        primary_private_dns: nextDnsHost(profile.id),
        fallback_private_dns: credentials.dot,
        fallback_doh: credentials.doh,
        fallback_doh_path: credentials.doh_path,
      },
      heartbeat: {
        ...heartbeatDefaults,
        checked_at: Date.now(),
      },
    };
  });
}
