import { getDb } from '../db/client.js';
import { getAdGuardHealth } from '../services/adguard.js';

function scalar(query, params = []) {
  return getDb().prepare(query).get(...params).value;
}

export function registerStatusRoutes(app) {
  app.get('/api/status', async (request, reply) => {
    const adguard = await getAdGuardHealth();
    const lastSyncError = getDb().prepare(`
      SELECT profile_id, action, message, created_at
      FROM sync_log
      WHERE status = 'error'
      ORDER BY created_at DESC
      LIMIT 1
    `).get() || null;

    const body = {
      ok: adguard.ok,
      status: adguard.ok ? 'ok' : 'degraded',
      database: {
        ok: true,
        profiles: scalar('SELECT COUNT(*) AS value FROM profiles'),
        active_profiles: scalar('SELECT COUNT(*) AS value FROM profiles WHERE active = 1'),
        cached_blocklists: scalar('SELECT COUNT(*) AS value FROM blocklist_cache'),
      },
      adguard,
      sync: {
        last_error: lastSyncError,
      },
    };

    return reply.status(adguard.ok ? 200 : 503).send(body);
  });
}
