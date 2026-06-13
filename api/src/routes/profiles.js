import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getDb } from '../db/client.js';
import {
  checkAdGuardHost,
  clearManagedUserRules,
  deleteAdGuardClient,
  ensureAdGuardClient,
  getAdGuardQueryLog,
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
const allowedCheckTypes = new Set(['A', 'AAAA', 'CNAME', 'HTTPS', 'MX', 'SVCB', 'TXT']);
const profileTemplates = [
  {
    id: 'basic_safe',
    name: 'Base segura',
    description: 'Publicidad, malware y excepciones Android esenciales.',
    categories: ['ads', 'malware', 'play_protect'],
    rules: [],
  },
  {
    id: 'no_social',
    name: 'Sin redes',
    description: 'Corta redes sociales y mensajeria, manteniendo proteccion base.',
    categories: ['ads', 'malware', 'social_media', 'messaging', 'play_protect'],
    rules: [],
  },
  {
    id: 'focus',
    name: 'Productividad',
    description: 'Reduce redes, video, juegos, compras y apuestas durante trabajo o clase.',
    categories: [
      'ads',
      'malware',
      'social_media',
      'messaging',
      'streaming',
      'gaming',
      'shopping',
      'dating',
      'gambling',
      'play_protect',
    ],
    rules: [],
  },
  {
    id: 'school',
    name: 'Escuela',
    description: 'Perfil estricto para menores o equipos de estudio supervisado.',
    categories: [
      'ads',
      'malware',
      'adult',
      'social_media',
      'messaging',
      'streaming',
      'gaming',
      'dating',
      'gambling',
      'play_protect',
    ],
    rules: [],
  },
  {
    id: 'streaming_blocked',
    name: 'Sin streaming',
    description: 'Bloquea video y musica sin endurecer otras areas del dispositivo.',
    categories: ['ads', 'malware', 'streaming', 'play_protect'],
    rules: [],
  },
  {
    id: 'personal',
    name: 'Personalizado',
    description: 'Empieza vacio para usar solo tus reglas o elegir filtros manualmente.',
    categories: [],
    rules: [],
  },
];

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

function availableProfileTemplates() {
  const categories = readCategories();

  return profileTemplates.map((template) => ({
    ...template,
    categories: template.categories.filter((category) => categories[category]),
  }));
}

function getProfileRow(profileId) {
  return getDb().prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
}

export function listProfileSummaries() {
  const rows = getDb().prepare('SELECT * FROM profiles ORDER BY created_at DESC').all();
  return rows.map(normalizeProfile);
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

function lastSyncForProfile(profileId) {
  return getDb().prepare(`
    SELECT profile_id, action, status, message, created_at
    FROM sync_log
    WHERE profile_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(profileId) || null;
}

function profileAudit(row) {
  const categoryConfig = readCategories();
  const categories = getProfileCategories(row.id);
  const profileRules = getProfileRules(row.id);
  const nativeServices = new Set();
  let fileRulesCount = 0;

  const categoryDetails = categories.map((entry) => {
    const config = categoryConfig[entry.category] || {};
    const manualRulesCount = categoryRulesFromConfig(entry.category).length;
    const cachedRulesCount = getCachedCategoryRules(entry.category).length;
    const blockedServices = categoryBlockedServicesFromConfig(entry.category);

    if (entry.enabled) {
      fileRulesCount += manualRulesCount + cachedRulesCount;
      for (const service of blockedServices) {
        nativeServices.add(service);
      }
    }

    return {
      id: entry.category,
      name: config.name || entry.category,
      description: config.description || '',
      enabled: entry.enabled,
      file_rules_count: manualRulesCount + cachedRulesCount,
      blocked_services: blockedServices,
    };
  });

  const managedRules = buildProfileScopedRules(row.id);
  const lastSync = lastSyncForProfile(row.id);

  return {
    profile_id: row.id,
    active: Boolean(row.active),
    categories: categoryDetails,
    native_services: [...nativeServices].sort(),
    filter_file: managedRules.length > 1 ? profileFilterLocation(row.id) : null,
    totals: {
      active_categories: categoryDetails.filter((category) => category.enabled).length,
      file_rules: fileRulesCount,
      manual_rules: profileRules.length,
      managed_rules: Math.max(0, managedRules.length - 1),
      native_services: nativeServices.size,
    },
    sync: {
      status: lastSync?.status || 'never',
      last: lastSync,
    },
  };
}

function normalizeCheckDomain(input) {
  let domain = String(input || '').trim().toLowerCase();
  if (!domain) {
    throw Object.assign(new Error('domain_required'), { statusCode: 400 });
  }

  domain = domain.replace(/^https?:\/\//, '').split('/')[0].split(':')[0].replace(/\.$/, '');
  const labels = domain.split('.');
  const valid = (
    domain.length <= 253
    && labels.length > 1
    && labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  );

  if (!valid) {
    throw Object.assign(new Error('invalid_domain'), { statusCode: 400 });
  }

  return domain;
}

function normalizeCheckType(input) {
  const qtype = String(input || 'A').trim().toUpperCase();
  if (!allowedCheckTypes.has(qtype)) {
    throw Object.assign(new Error('invalid_qtype'), { statusCode: 400 });
  }

  return qtype;
}

async function checkProfileDomain(profileId, domain, qtype) {
  const result = await checkAdGuardHost(profileId, domain, qtype);
  const rules = Array.isArray(result.rules) ? result.rules : [];
  const rule = result.rule || rules[0]?.text || null;
  const reason = result.reason || 'Unknown';

  return {
    profile_id: profileId,
    domain,
    qtype,
    status: reason.startsWith('Filtered') ? 'blocked' : 'allowed',
    reason,
    service_name: result.service_name || null,
    rule,
    filter_id: result.filter_id ?? null,
    rules: rules.map((row) => ({
      text: row.text,
      filter_list_id: row.filter_list_id ?? null,
    })),
    checked_at: Date.now(),
  };
}

function normalizeQueryLogEntry(entry) {
  const reason = entry.reason || 'Unknown';

  return {
    time: entry.time || null,
    domain: entry.question?.name || null,
    type: entry.question?.type || null,
    client: entry.client || null,
    client_name: entry.client_info?.name || null,
    status: reason.startsWith('Filtered') ? 'blocked' : 'allowed',
    reason,
    service_name: entry.service_name || null,
    rule: entry.rule || null,
    filter_id: entry.filterId || null,
  };
}

export async function profileLogs(profileId, limit = 120) {
  const row = getProfileRow(profileId);
  if (!row) {
    return [];
  }

  const entries = await getAdGuardQueryLog(limit);
  return entries
    .filter((entry) => entry.client_info?.name === row.id)
    .map(normalizeQueryLogEntry);
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

  if (rules.length <= 1) {
    await removeProfileFilterFile(profileId);
    return null;
  }

  await mkdir(path.dirname(localPath), { recursive: true });
  await writeFile(localPath, `${rules.join('\n')}\n`, 'utf8');

  return profileFilterLocation(profileId);
}

export async function writeActiveProfileFilterFiles() {
  const rows = getDb().prepare('SELECT id FROM profiles WHERE active = 1 ORDER BY id').all();
  for (const row of rows) {
    const filterLocation = await writeProfileFilterFile(row.id);
    if (filterLocation) {
      await upsertAdGuardProfileFilter(row.id, filterLocation, true);
    } else {
      await removeAdGuardProfileFilter(row.id);
    }
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
    const filterLocation = row.active ? await writeProfileFilterFile(row.id) : null;
    if (filterLocation) {
      await upsertAdGuardProfileFilter(row.id, filterLocation, true);
    } else {
      await removeProfileFilterFile(row.id);
      await removeAdGuardProfileFilter(row.id);
    }

    await clearManagedUserRules();
    logSync(profileId, action, 'ok');
  } catch (error) {
    logSync(profileId, action, 'error', error.message);
    throw error;
  }
}

export function registerProfileRoutes(app) {
  app.get('/api/profile-templates', async () => ({
    templates: availableProfileTemplates(),
  }));

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
    return { profiles: listProfileSummaries() };
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

  app.get('/api/profiles/:id/audit', async (request, reply) => {
    const row = getProfileRow(request.params.id);
    if (!row) {
      reply.status(404).send({ error: 'not_found' });
      return;
    }

    return profileAudit(row);
  });

  app.get('/api/profiles/:id/check', async (request, reply) => {
    const row = getProfileRow(request.params.id);
    if (!row) {
      reply.status(404).send({ error: 'not_found' });
      return;
    }

    const domain = normalizeCheckDomain(request.query?.domain || request.query?.name);
    const qtype = normalizeCheckType(request.query?.qtype);

    return checkProfileDomain(row.id, domain, qtype);
  });

  app.get('/api/profiles/:id/logs', async (request, reply) => {
    const row = getProfileRow(request.params.id);
    if (!row) {
      reply.status(404).send({ error: 'not_found' });
      return;
    }

    const logs = await profileLogs(row.id, Number(request.query?.limit || 120));

    return {
      profile_id: row.id,
      logs,
    };
  });
}
