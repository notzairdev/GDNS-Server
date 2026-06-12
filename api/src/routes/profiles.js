import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getDb } from '../db/client.js';
import {
  clearManagedUserRules,
  deleteAdGuardClient,
  ensureAdGuardClient,
  profileFilterLocation,
  removeAdGuardProfileFilter,
  upsertAdGuardProfileFilter,
} from '../services/adguard.js';
import {
  categoryBlockedServicesFromConfig,
  categoryRulesFromConfig,
  getCachedCategoryRules,
  readCategories,
} from '../services/blocklists.js';

const profileIdPattern = /^[a-z0-9-]{3,63}$/;
const defaultCategories = ['ads', 'malware'];

function profileFilterLocalPath(profileId) {
  const filtersDir = process.env.PROFILE_FILTERS_DIR || path.join(process.cwd(), 'data', 'profile-filters');
  return path.join(filtersDir, `${profileId}.txt`);
}

function appendUniqueRules(target, rules) {
  for (const rule of rules) {
    target.add(rule);
  }
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

function getProfileRow(profileId) {
  return getDb().prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
}

function getProfileCategories(profileId) {
  return getDb()
    .prepare('SELECT category, enabled FROM profile_categories WHERE profile_id = ? ORDER BY category')
    .all(profileId)
    .map((row) => ({
      category: row.category,
      enabled: Boolean(row.enabled),
    }));
}

function getProfileRules(profileId) {
  return getDb()
    .prepare('SELECT id, rule, type, created_at FROM profile_rules WHERE profile_id = ? ORDER BY id')
    .all(profileId);
}

function profileResponse(row) {
  return {
    ...normalizeProfile(row),
    categories: getProfileCategories(row.id),
    rules: getProfileRules(row.id),
  };
}

function validateProfileInput(body, idRequired) {
  const id = String(body.id || '').toLowerCase().trim();
  const name = String(body.name || id).trim();
  const deviceName = body.device_name ? String(body.device_name).trim() : null;
  const active = body.active === undefined ? true : Boolean(body.active);

  if (idRequired && !profileIdPattern.test(id)) {
    throw Object.assign(new Error('invalid_profile_id'), { statusCode: 400 });
  }

  if (!name) {
    throw Object.assign(new Error('invalid_name'), { statusCode: 400 });
  }

  return { id, name, deviceName, active };
}

function normalizeCategoryInput(input, useDefaults) {
  const available = readCategories();
  const rawCategories = input === undefined && useDefaults ? defaultCategories : input;

  if (rawCategories === undefined) {
    return null;
  }

  if (Array.isArray(rawCategories)) {
    return rawCategories.map((category) => ({ category, enabled: true }));
  }

  if (rawCategories && typeof rawCategories === 'object') {
    return Object.entries(rawCategories).map(([category, enabled]) => ({
      category,
      enabled: Boolean(enabled),
    }));
  }

  throw Object.assign(new Error('invalid_categories'), { statusCode: 400 });
}

function setProfileCategories(profileId, input, useDefaults = false) {
  const categories = normalizeCategoryInput(input, useDefaults);
  if (!categories) {
    return;
  }

  const available = readCategories();
  const db = getDb();
  db.prepare('DELETE FROM profile_categories WHERE profile_id = ?').run(profileId);

  const insert = db.prepare(`
    INSERT INTO profile_categories (profile_id, category, enabled)
    VALUES (?, ?, ?)
  `);

  for (const entry of categories) {
    if (!available[entry.category]) {
      throw Object.assign(new Error(`unknown_category:${entry.category}`), { statusCode: 400 });
    }

    insert.run(profileId, entry.category, entry.enabled ? 1 : 0);
  }
}

function setProfileRules(profileId, rules) {
  if (rules === undefined) {
    return;
  }

  if (!Array.isArray(rules)) {
    throw Object.assign(new Error('invalid_rules'), { statusCode: 400 });
  }

  const db = getDb();
  const now = Date.now();
  db.prepare('DELETE FROM profile_rules WHERE profile_id = ?').run(profileId);

  const insert = db.prepare(`
    INSERT INTO profile_rules (profile_id, rule, type, created_at)
    VALUES (?, ?, ?, ?)
  `);

  for (const item of rules) {
    const rule = String(item.rule || '').trim();
    const type = String(item.type || 'block');
    if (!rule || !['block', 'allow'].includes(type)) {
      throw Object.assign(new Error('invalid_rule'), { statusCode: 400 });
    }

    insert.run(profileId, rule, type, now);
  }
}

function withClientOption(rule, profileId) {
  if (!rule || rule.startsWith('#')) {
    return null;
  }

  if (rule.includes('$')) {
    return `${rule},client=${profileId}`;
  }

  return `${rule}$client=${profileId}`;
}

function manualProfileRule(row) {
  if (row.type === 'allow' && !row.rule.startsWith('@@')) {
    return `@@${row.rule}`;
  }

  return row.rule;
}

function buildProfileScopedRules(profileId) {
  const db = getDb();
  const profileRules = new Set();
  const managedRules = [`# gdns:profile:${profileId}`];
  const categories = db.prepare(`
    SELECT category FROM profile_categories
    WHERE profile_id = ? AND enabled = 1
    ORDER BY category
  `).all(profileId);

  for (const row of categories) {
    appendUniqueRules(profileRules, getCachedCategoryRules(row.category));
    appendUniqueRules(profileRules, categoryRulesFromConfig(row.category));
  }

  appendUniqueRules(profileRules, getProfileRules(profileId).map(manualProfileRule));

  for (const rule of profileRules) {
    const scopedRule = withClientOption(rule, profileId);
    if (scopedRule) {
      managedRules.push(scopedRule);
    }
  }

  return managedRules;
}

function blockedServicesForProfile(profileId) {
  const db = getDb();
  const services = new Set();
  const categories = db.prepare(`
    SELECT category FROM profile_categories
    WHERE profile_id = ? AND enabled = 1
    ORDER BY category
  `).all(profileId);

  for (const row of categories) {
    for (const service of categoryBlockedServicesFromConfig(row.category)) {
      services.add(service);
    }
  }

  return [...services].sort();
}

async function removeProfileFilterFile(profileId) {
  await rm(profileFilterLocalPath(profileId), { force: true });
}

async function writeProfileFilterFile(profileId) {
  const localPath = profileFilterLocalPath(profileId);
  const rules = buildProfileScopedRules(profileId);

  await mkdir(path.dirname(localPath), { recursive: true });
  await writeFile(localPath, `${rules.join('\n')}\n`, 'utf8');

  return profileFilterLocation(profileId);
}

export async function writeActiveProfileFilterFiles() {
  const rows = getDb().prepare('SELECT id FROM profiles WHERE active = 1 ORDER BY id').all();
  for (const row of rows) {
    await writeProfileFilterFile(row.id);
  }
}

function logSync(profileId, action, status, message = null) {
  getDb().prepare(`
    INSERT INTO sync_log (profile_id, action, status, message, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(profileId, action, status, message, Date.now());
}

async function syncProfile(profileId, action = 'sync') {
  const row = getProfileRow(profileId);
  if (!row) {
    throw Object.assign(new Error('not_found'), { statusCode: 404 });
  }

  try {
    await ensureAdGuardClient({
      id: row.id,
      name: row.name,
      active: Boolean(row.active),
      blocked_services: blockedServicesForProfile(row.id),
    });
    const filterLocation = row.active
      ? await writeProfileFilterFile(row.id)
      : profileFilterLocation(row.id);
    if (!row.active) {
      await removeProfileFilterFile(row.id);
    }

    await upsertAdGuardProfileFilter(row.id, filterLocation, Boolean(row.active));
    await clearManagedUserRules();
    logSync(profileId, action, 'ok');
  } catch (error) {
    logSync(profileId, action, 'error', error.message);
    throw error;
  }
}

export function registerProfileRoutes(app) {
  app.get('/internal/profiles/:id/filter.txt', async (request, reply) => {
    const row = getProfileRow(request.params.id);
    if (!row || !row.active) {
      reply.status(404).send('not found\n');
      return;
    }

    return reply
      .header('content-type', 'text/plain; charset=utf-8')
      .send(`${buildProfileScopedRules(row.id).join('\n')}\n`);
  });

  app.get('/api/profiles', async () => {
    const rows = getDb().prepare('SELECT * FROM profiles ORDER BY created_at DESC').all();
    return { profiles: rows.map(normalizeProfile) };
  });

  app.post('/api/profiles', async (request, reply) => {
    const now = Date.now();
    const body = request.body || {};
    const input = validateProfileInput(body, true);
    const db = getDb();

    const createProfile = db.transaction(() => {
      db.prepare(`
        INSERT INTO profiles (id, name, device_name, created_at, updated_at, active)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(input.id, input.name, input.deviceName, now, now, input.active ? 1 : 0);
      setProfileCategories(input.id, body.categories, true);
      setProfileRules(input.id, body.rules);
    });

    try {
      createProfile();
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) {
        reply.status(409).send({ error: 'profile_exists' });
        return;
      }

      throw error;
    }

    await syncProfile(input.id, 'create');

    reply.status(201).send({
      profile: profileResponse(getProfileRow(input.id)),
      credentials: credentialsFor(input.id),
    });
  });

  app.get('/api/profiles/:id', async (request, reply) => {
    const row = getProfileRow(request.params.id);
    if (!row) {
      reply.status(404).send({ error: 'not_found' });
      return;
    }

    return { profile: profileResponse(row) };
  });

  app.put('/api/profiles/:id', async (request, reply) => {
    const row = getProfileRow(request.params.id);
    if (!row) {
      reply.status(404).send({ error: 'not_found' });
      return;
    }

    const body = request.body || {};
    const name = body.name === undefined ? row.name : String(body.name).trim();
    const deviceName = body.device_name === undefined
      ? row.device_name
      : body.device_name ? String(body.device_name).trim() : null;
    const active = body.active === undefined ? Boolean(row.active) : Boolean(body.active);

    if (!name) {
      reply.status(400).send({ error: 'invalid_name' });
      return;
    }

    getDb().transaction(() => {
      getDb().prepare(`
        UPDATE profiles
        SET name = ?, device_name = ?, active = ?, updated_at = ?
        WHERE id = ?
      `).run(name, deviceName, active ? 1 : 0, Date.now(), row.id);
      setProfileCategories(row.id, body.categories);
      setProfileRules(row.id, body.rules);
    })();

    await syncProfile(row.id, 'update');

    return {
      profile: profileResponse(getProfileRow(row.id)),
      credentials: credentialsFor(row.id),
    };
  });

  app.delete('/api/profiles/:id', async (request, reply) => {
    const row = getProfileRow(request.params.id);
    if (!row) {
      reply.status(404).send({ error: 'not_found' });
      return;
    }

    getDb().prepare('DELETE FROM profiles WHERE id = ?').run(row.id);

    try {
      await deleteAdGuardClient(row.id);
      await removeAdGuardProfileFilter(row.id);
      await removeProfileFilterFile(row.id);
      await clearManagedUserRules();
      logSync(row.id, 'delete', 'ok');
    } catch (error) {
      logSync(row.id, 'delete', 'error', error.message);
      throw error;
    }

    reply.status(204).send();
  });

  app.post('/api/profiles/:id/sync', async (request, reply) => {
    const row = getProfileRow(request.params.id);
    if (!row) {
      reply.status(404).send({ error: 'not_found' });
      return;
    }

    await syncProfile(row.id);
    return { profile: profileResponse(getProfileRow(row.id)) };
  });

  app.get('/api/profiles/:id/credentials', async (request, reply) => {
    const row = getProfileRow(request.params.id);
    if (!row) {
      reply.status(404).send({ error: 'not_found' });
      return;
    }

    return credentialsFor(row.id);
  });
}
