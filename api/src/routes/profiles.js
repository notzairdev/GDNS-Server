import { getDb } from '../db/client.js';
import { ensureAdGuardClient } from '../services/adguard.js';

const profileIdPattern = /^[a-z0-9-]{3,63}$/;

function isAuthorized(request) {
 const secret = process.env.API_SECRET;
 if (!secret) {
    return true;
  }

  const auth = request.headers.authorization || '';
  return auth === `Bearer ${secret}`;
}

function normalizeProfile(row) {
  return {
    id: row.id,
    name: row.name,
    device_name: row.device_name,
    active: Boolean(row.active),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function credentialsFor(profileId) {
  const domain = process.env.DNS_DOMAIN;
  if (!domain) {
    throw Object.assign(new Error('DNS_DOMAIN is required'), { statusCode: 500 });
  }

  return {
    profile_id: profileId,
    doh: `https://${profileId}.dns.${domain}/dns-query`,
    dot: `${profileId}.dns.${domain}`,
    doh_path: `https://dns.${domain}/dns-query/${profileId}`,
    plain_dns: process.env.PLAIN_DNS_IP || null,
  };
}

export function registerProfileRoutes(app) {
  app.addHook('preHandler', async (request, reply) => {
    if (request.method !== 'GET' || request.url.startsWith('/api/profiles')) {
      if (!isAuthorized(request)) {
        return reply.status(401).send({ error: 'unauthorized' });
      }
    }

    return undefined;
  });

  app.get('/api/profiles', async () => {
    const rows = getDb().prepare('SELECT * FROM profiles ORDER BY created_at DESC').all();
    return { profiles: rows.map(normalizeProfile) };
  });

  app.post('/api/profiles', async (request, reply) => {
    const now = Date.now();
    const body = request.body || {};
    const id = String(body.id || '').toLowerCase().trim();
    const name = String(body.name || id).trim();
    const deviceName = body.device_name ? String(body.device_name).trim() : null;

    if (!profileIdPattern.test(id)) {
      reply.status(400).send({ error: 'invalid_profile_id' });
      return;
    }

    if (!name) {
      reply.status(400).send({ error: 'invalid_name' });
      return;
    }

    const db = getDb();
    try {
      db.prepare(`
        INSERT INTO profiles (id, name, device_name, created_at, updated_at, active)
        VALUES (?, ?, ?, ?, ?, 1)
      `).run(id, name, deviceName, now, now);
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) {
        reply.status(409).send({ error: 'profile_exists' });
        return;
      }

      throw error;
    }

    await ensureAdGuardClient({
      id,
      name: id,
      deviceName: name,
    });

    reply.status(201).send({
      profile: normalizeProfile(db.prepare('SELECT * FROM profiles WHERE id = ?').get(id)),
      credentials: credentialsFor(id),
    });
  });

  app.get('/api/profiles/:id', async (request, reply) => {
    const row = getDb().prepare('SELECT * FROM profiles WHERE id = ?').get(request.params.id);
    if (!row) {
      reply.status(404).send({ error: 'not_found' });
      return;
    }

    return { profile: normalizeProfile(row) };
  });

  app.get('/api/profiles/:id/credentials', async (request, reply) => {
    const row = getDb().prepare('SELECT id FROM profiles WHERE id = ?').get(request.params.id);
    if (!row) {
      reply.status(404).send({ error: 'not_found' });
      return;
    }

    return credentialsFor(row.id);
  });
}
