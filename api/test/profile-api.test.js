import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import test from 'node:test';

import { buildApp } from '../src/app.js';
import { closeDb, getDb } from '../src/db/client.js';

function setEnv(overrides = {}) {
  process.env.API_SECRET = 'test-secret';
  process.env.DNS_DOMAIN = 'example.test';
  process.env.PLAIN_DNS_IP = '203.0.113.10';
  process.env.AGH_USER = 'admin';
  process.env.AGH_PASS = 'password';

  for (const [key, value] of Object.entries(overrides)) {
    process.env[key] = value;
  }
}

async function withTempDb(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'gdns-api-test-'));
  process.env.DB_PATH = path.join(dir, 'profiles.db');
  process.env.PROFILE_FILTERS_DIR = path.join(dir, 'profile-filters');
  process.env.AGH_PROFILE_FILTERS_DIR = '/opt/adguardhome/profile-filters';
  closeDb();

  try {
    await fn();
  } finally {
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
}

async function startAdGuardMock(options = {}) {
  const calls = [];
  let clients = options.clients ?? [];
  const autoClients = options.autoClients || [];
  let filters = options.filters ?? [];
  let userRules = ['||existing.example^'];
  const queryLog = options.queryLog || [];

  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      const parsedBody = body ? JSON.parse(body) : null;
      calls.push({ method: request.method, url: request.url, body: parsedBody });
      response.setHeader('content-type', 'application/json');

      if (request.method === 'GET' && request.url === '/control/status') {
        response.end(JSON.stringify({
          protection_enabled: true,
          running: true,
          version: 'test',
        }));
        return;
      }

      if (request.method === 'POST' && request.url === '/control/clients/search') {
        response.end(JSON.stringify([]));
        return;
      }

      if (request.method === 'GET' && request.url === '/control/clients') {
        response.end(JSON.stringify({
          clients,
          auto_clients: autoClients,
          supported_tags: [],
        }));
        return;
      }

      if (request.method === 'GET' && request.url === '/control/filtering/status') {
        response.end(JSON.stringify({ filters, user_rules: userRules }));
        return;
      }

      if (request.method === 'GET' && request.url.startsWith('/control/querylog')) {
        response.end(JSON.stringify({ data: queryLog }));
        return;
      }

      if (request.method === 'GET' && request.url.startsWith('/control/filtering/check_host')) {
        const url = new URL(request.url, 'http://127.0.0.1');
        const domain = url.searchParams.get('name');
        const client = url.searchParams.get('client');
        response.end(JSON.stringify({
          reason: domain === 'youtube.com' ? 'FilteredBlockedService' : 'NotFilteredNotFound',
          service_name: domain === 'youtube.com' ? 'YouTube' : '',
          rule: domain === 'youtube.com' ? '||youtube.com^' : '',
          filter_id: domain === 'youtube.com' ? 0 : null,
          rules: domain === 'youtube.com'
            ? [{ text: `||youtube.com^$client=${client}`, filter_list_id: 0 }]
            : [],
        }));
        return;
      }

      if (request.method === 'GET' && request.url === '/control/blocked_services/all') {
        response.end(JSON.stringify({
          blocked_services: [
            {
              id: 'playstore',
              name: 'Google Play Store',
              group_id: 'software',
              rules: ['||play-fe.googleapis.com^'],
            },
            {
              id: 'youtube',
              name: 'YouTube',
              group_id: 'streaming',
              rules: ['||youtube.com^', '||ytimg.com^'],
            },
            {
              id: 'netflix',
              name: 'Netflix',
              group_id: 'streaming',
              rules: ['||netflix.com^'],
            },
          ],
        }));
        return;
      }

      if (request.method === 'POST' && request.url === '/control/filtering/add_url') {
        filters = Array.isArray(filters) ? filters : [];
        filters.push({
          name: parsedBody.name,
          url: parsedBody.url,
          enabled: true,
        });
        response.end('OK 1 rules\n');
        return;
      }

      if (request.method === 'POST' && request.url === '/control/filtering/remove_url') {
        filters = Array.isArray(filters)
          ? filters.filter((filter) => filter.url !== parsedBody.url)
          : [];
        response.end('OK 0 rules\n');
        return;
      }

      if (request.method === 'POST' && request.url === '/control/filtering/refresh') {
        response.end(JSON.stringify({ updated: filters.length }));
        return;
      }

      if (request.method === 'POST' && request.url === '/control/filtering/set_rules') {
        userRules = parsedBody.rules;
        response.end(JSON.stringify({ ok: true }));
        return;
      }

      if (request.method === 'POST' && request.url === '/control/clients/add') {
        clients = Array.isArray(clients) ? clients : [];
        clients.push(parsedBody);
        response.end(JSON.stringify({ ok: true }));
        return;
      }

      if (request.method === 'POST' && request.url === '/control/clients/update') {
        clients = Array.isArray(clients) ? clients : [];
        const index = clients.findIndex((client) => client.name === parsedBody.name);
        if (index === -1) {
          response.statusCode = 400;
          response.end(JSON.stringify({ error: 'not_found' }));
          return;
        }

        clients[index] = parsedBody.data;
        response.end(JSON.stringify({ ok: true }));
        return;
      }

      if (request.method === 'POST' && request.url === '/control/clients/delete') {
        clients = Array.isArray(clients)
          ? clients.filter((client) => client.name !== parsedBody.name)
          : [];
        response.end(JSON.stringify({ ok: true }));
        return;
      }

      response.statusCode = 404;
      response.end(JSON.stringify({ error: 'not_found' }));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  return {
    url: `http://127.0.0.1:${server.address().port}`,
    calls,
    get userRules() {
      return userRules;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function withAppAndMock(fn, mockOptions = {}) {
  const mock = await startAdGuardMock(mockOptions);
  setEnv({ AGH_INTERNAL_URL: mock.url });

  await withTempDb(async () => {
    const app = await buildApp({ logger: false });

    try {
      await fn({ app, mock });
    } finally {
      await app.close();
      await mock.close();
    }
  });
}

test('health is public while api routes require bearer auth', async () => {
  await withAppAndMock(async ({ app }) => {
    const health = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(health.statusCode, 200);
    assert.deepEqual(health.json(), { ok: true, service: 'gdns-profile-api' });

    const unauthorized = await app.inject({ method: 'GET', url: '/api/profiles' });
    assert.equal(unauthorized.statusCode, 401);

    const authorized = await app.inject({
      method: 'GET',
      url: '/api/profiles',
      headers: { authorization: 'Bearer test-secret' },
    });
    assert.equal(authorized.statusCode, 200);
    assert.deepEqual(authorized.json(), { profiles: [] });
  });
});

test('serves public APK heartbeat contract for profile failover', async () => {
  await withAppAndMock(async ({ app }) => {
    const missing = await app.inject({ method: 'GET', url: '/apk/heartbeat/missing-profile' });
    assert.equal(missing.statusCode, 404);
    assert.deepEqual(missing.json(), { ok: false, error: 'profile_not_found' });

    const invalid = await app.inject({ method: 'GET', url: '/apk/heartbeat/bad_profile' });
    assert.equal(invalid.statusCode, 400);
    assert.deepEqual(invalid.json(), { ok: false, error: 'invalid_profile_id' });

    const created = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      headers: {
        authorization: 'Bearer test-secret',
        'content-type': 'application/json',
      },
      payload: {
        id: 'abc123',
        name: 'Pixel 8',
        device_name: 'Pixel 8',
        categories: [],
      },
    });
    assert.equal(created.statusCode, 201);

    const heartbeat = await app.inject({ method: 'GET', url: '/apk/heartbeat/abc123' });
    assert.equal(heartbeat.statusCode, 200);
    assert.equal(heartbeat.headers['cache-control'], 'no-store');

    const body = heartbeat.json();
    assert.equal(body.ok, true);
    assert.equal(body.service, 'gdns-profile-api');
    assert.deepEqual(body.profile, {
      id: 'abc123',
      active: true,
      updated_at: body.profile.updated_at,
    });
    assert.equal(body.failover.available, true);
    assert.equal(body.failover.reason, null);
    assert.equal(body.failover.primary_private_dns, 'abc123.dns.nextdns.io');
    assert.equal(body.failover.fallback_private_dns, 'abc123.dns.example.test');
    assert.equal(body.failover.fallback_doh, 'https://abc123.dns.example.test/dns-query');
    assert.equal(body.failover.fallback_doh_path, 'https://dns.example.test/dns-query/abc123');
    assert.equal(body.heartbeat.interval_ms, 1000);
    assert.equal(body.heartbeat.timeout_ms, 1200);
    assert.equal(body.heartbeat.failure_threshold, 2);
    assert.equal(body.heartbeat.restore_threshold, 3);
    assert.deepEqual(body.heartbeat.backoff_ms, [250, 500, 1000, 2000, 5000, 10000]);
    assert.equal(body.heartbeat.path, '/apk/heartbeat/abc123');
    assert.equal(body.heartbeat.url, 'https://localhost:80/apk/heartbeat/abc123');
    assert.equal(typeof body.heartbeat.checked_at, 'number');
    assert.equal(body.switching.blackhole_required, true);
    assert.equal(body.switching.device_owner_required, true);
    assert.match(body.setup_uri, /^gdns:\/\/profile\?/);
    const setupUri = new URL(body.setup_uri);
    assert.equal(setupUri.searchParams.get('heartbeat'), 'https://localhost:80/apk/heartbeat/abc123');
    assert.equal(setupUri.searchParams.get('heartbeat_path'), '/apk/heartbeat/abc123');
  });
});

test('provisions matching GDNS profile contract for the C# agent', async () => {
  await withAppAndMock(async ({ app }) => {
    const unauthorized = await app.inject({
      method: 'POST',
      url: '/api/apk/provision',
      headers: { 'content-type': 'application/json' },
      payload: {
        profile_id: 'abc123',
        template_id: 'no_social',
      },
    });
    assert.equal(unauthorized.statusCode, 401);

    const created = await app.inject({
      method: 'POST',
      url: '/api/apk/provision',
      headers: {
        authorization: 'Bearer test-secret',
        'content-type': 'application/json',
        host: 'gdns.example.test',
        'x-forwarded-proto': 'https',
      },
      payload: {
        profile_id: 'abc123',
        name: 'Pixel 8',
        device_name: 'Pixel 8',
        template_id: 'no_social',
        nextdns_private_dns: 'abc123.dns.nextdns.io',
      },
    });
    assert.equal(created.statusCode, 201);

    const body = created.json();
    assert.equal(body.provisioning.action, 'created');
    assert.equal(body.provisioning.profile_id, 'abc123');
    assert.equal(body.provisioning.template_id, 'no_social');
    assert.equal(body.nextdns.private_dns, 'abc123.dns.nextdns.io');
    assert.equal(body.credentials.dot, 'abc123.dns.example.test');
    assert.equal(body.apk.heartbeat.path, '/apk/heartbeat/abc123');
    assert.equal(body.apk.heartbeat.url, 'https://gdns.example.test/apk/heartbeat/abc123');
    assert.equal(body.apk.failover.primary_private_dns, 'abc123.dns.nextdns.io');
    assert.equal(body.apk.failover.fallback_private_dns, 'abc123.dns.example.test');
    assert.equal(body.apk.switching.blackhole_required, true);
    assert.match(body.apk.setup_uri, /^gdns:\/\/profile\?/);
    const setupUri = new URL(body.apk.setup_uri);
    assert.equal(setupUri.searchParams.get('heartbeat'), 'https://gdns.example.test/apk/heartbeat/abc123');
    assert.equal(setupUri.searchParams.get('heartbeat_path'), '/apk/heartbeat/abc123');

    const categories = body.profile.categories
      .filter((category) => category.enabled)
      .map((category) => category.category)
      .sort();
    assert.deepEqual(categories, ['ads', 'malware', 'messaging', 'play_protect', 'social_media']);

    const updated = await app.inject({
      method: 'POST',
      url: '/api/apk/provision',
      headers: {
        authorization: 'Bearer test-secret',
        'content-type': 'application/json',
      },
      payload: {
        profile_id: 'abc123',
        template_id: 'streaming_blocked',
        name: 'Pixel 8 Updated',
      },
    });
    assert.equal(updated.statusCode, 200);
    assert.equal(updated.json().provisioning.action, 'updated');
    assert.equal(updated.json().provisioning.template_id, 'streaming_blocked');

    const updatedCategories = updated.json().profile.categories
      .filter((category) => category.enabled)
      .map((category) => category.category)
      .sort();
    assert.deepEqual(updatedCategories, ['ads', 'malware', 'play_protect', 'streaming']);
  });
});

test('creates a signed dashboard session cookie', async () => {
  await withAppAndMock(async ({ app }) => {
    const initialSession = await app.inject({ method: 'GET', url: '/api/session' });
    assert.equal(initialSession.statusCode, 200);
    assert.deepEqual(initialSession.json(), { authenticated: false });

    const rejected = await app.inject({
      method: 'POST',
      url: '/api/session',
      headers: { 'content-type': 'application/json' },
      payload: { token: 'wrong-secret' },
    });
    assert.equal(rejected.statusCode, 401);

    const session = await app.inject({
      method: 'POST',
      url: '/api/session',
      headers: { 'content-type': 'application/json', 'user-agent': 'light-client' },
      payload: { token: 'test-secret' },
    });
    assert.equal(session.statusCode, 200);
    assert.deepEqual(session.json(), { authenticated: true });

    assert.match(session.headers['set-cookie'], /HttpOnly/);
    assert.match(session.headers['set-cookie'], /SameSite=Strict/);

    const cookie = session.headers['set-cookie'].split(';')[0];
    assert.match(cookie, /^gdns_session=/);

    const authorized = await app.inject({
      method: 'GET',
      url: '/api/profiles',
      headers: { cookie, 'user-agent': 'light-client' },
    });
    assert.equal(authorized.statusCode, 200);
    assert.deepEqual(authorized.json(), { profiles: [] });

    const activeSession = await app.inject({
      method: 'GET',
      url: '/api/session',
      headers: { cookie, 'user-agent': 'light-client' },
    });
    assert.deepEqual(activeSession.json(), { authenticated: true });

    const otherBrowser = await app.inject({
      method: 'GET',
      url: '/api/profiles',
      headers: { cookie, 'user-agent': 'other-browser' },
    });
    assert.equal(otherBrowser.statusCode, 401);

    const logout = await app.inject({
      method: 'DELETE',
      url: '/api/session',
    });
    assert.equal(logout.statusCode, 200);
    assert.match(String(logout.headers['set-cookie']), /Max-Age=0/);
  });
});

test('temporarily locks session login after repeated failures', async () => {
  await withAppAndMock(async ({ app }) => {
    const headers = {
      'content-type': 'application/json',
      'user-agent': 'lock-test',
      'x-forwarded-for': '198.51.100.22',
    };

    for (let index = 0; index < 5; index += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/session',
        headers,
        payload: { token: 'wrong-secret' },
      });
      assert.equal(response.statusCode, 401);
    }

    const locked = await app.inject({
      method: 'POST',
      url: '/api/session',
      headers,
      payload: { token: 'test-secret' },
    });
    assert.equal(locked.statusCode, 429);
  });
});

test('creates profile, syncs AGH client, and scopes managed rules by client', async () => {
  await withAppAndMock(async ({ app, mock }) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      headers: {
        authorization: 'Bearer test-secret',
        'content-type': 'application/json',
      },
      payload: {
        id: 'abc123',
        name: 'Pixel 8',
        device_name: 'Pixel 8',
        categories: ['social_media'],
        rules: [
          { type: 'block', rule: '||example.org^' },
          { type: 'allow', rule: '||safe.example.org^' },
        ],
      },
    });

    assert.equal(response.statusCode, 201);
    const body = response.json();
    assert.equal(body.profile.id, 'abc123');
    assert.equal(body.credentials.dot, 'abc123.dns.example.test');

    const addClient = mock.calls.find((call) => call.url === '/control/clients/add');
    assert.ok(addClient);
    assert.equal(addClient.body.use_global_blocked_services, false);
    for (const service of ['facebook', 'instagram', 'tiktok', 'twitter', 'reddit', 'snapchat']) {
      assert.ok(addClient.body.blocked_services.includes(service), service);
    }
    assert.ok(mock.calls.some((call) => (
      call.url === '/control/filtering/add_url'
      && call.body.url === '/opt/adguardhome/profile-filters/abc123.txt'
    )));

    const filter = await app.inject({ method: 'GET', url: '/internal/profiles/abc123/filter.txt' });
    assert.equal(filter.statusCode, 200);
    assert.match(filter.body, /# gdns:profile:abc123/);
    assert.match(filter.body, /\|\|example\.org\^\$client=abc123/);
    assert.match(filter.body, /@@\|\|safe\.example\.org\^\$client=abc123/);
  });
});

test('creates persistent AGH client when only a runtime auto client matches', async () => {
  await withAppAndMock(async ({ app, mock }) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      headers: {
        authorization: 'Bearer test-secret',
        'content-type': 'application/json',
      },
      payload: {
        id: 'abc123',
        name: 'Pixel 8',
      },
    });

    assert.equal(response.statusCode, 201);
    assert.ok(mock.calls.some((call) => call.url === '/control/clients/add'));
    assert.ok(!mock.calls.some((call) => call.url === '/control/clients/update'));
  }, {
    clients: null,
    autoClients: [{ name: '', ids: ['abc123'] }],
  });
});

test('syncs service-only categories without registering blank profile filter', async () => {
  await withAppAndMock(async ({ app, mock }) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      headers: {
        authorization: 'Bearer test-secret',
        'content-type': 'application/json',
      },
      payload: {
        id: 'stream1',
        name: 'TV',
        categories: ['streaming'],
      },
    });

    assert.equal(response.statusCode, 201);

    const addClient = mock.calls.find((call) => call.url === '/control/clients/add');
    assert.ok(addClient);
    assert.equal(addClient.body.use_global_blocked_services, false);
    assert.ok(addClient.body.blocked_services.includes('youtube'));
    assert.ok(addClient.body.blocked_services.includes('netflix'));
    assert.ok(!mock.calls.some((call) => call.url === '/control/filtering/add_url'));
  });
});

test('returns predefined rules for category previews', async () => {
  await withAppAndMock(async ({ app }) => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/blocklists/categories/play_protect/rules?limit=50',
      headers: { authorization: 'Bearer test-secret' },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.category.id, 'play_protect');
    assert.ok(body.file_rules.rules.includes('@@||play.googleapis.com^'));
    assert.deepEqual(body.blocked_services, []);

    const streaming = await app.inject({
      method: 'GET',
      url: '/api/blocklists/categories/streaming/rules?limit=50',
      headers: { authorization: 'Bearer test-secret' },
    });
    assert.equal(streaming.statusCode, 200);
    assert.ok(streaming.json().blocked_services.some((service) => service.id === 'youtube'));
  });
});

test('returns profile templates, audit details, and profile-scoped domain checks', async () => {
  await withAppAndMock(async ({ app }) => {
    const headers = {
      authorization: 'Bearer test-secret',
      'content-type': 'application/json',
    };

    const templates = await app.inject({
      method: 'GET',
      url: '/api/profile-templates',
      headers: { authorization: 'Bearer test-secret' },
    });
    assert.equal(templates.statusCode, 200);
    assert.ok(templates.json().templates.some((template) => template.id === 'school'));
    assert.ok(templates.json().templates.some((template) => template.id === 'personal'));

    const created = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      headers,
      payload: {
        id: 'audit1',
        name: 'Audit phone',
        categories: ['streaming', 'play_protect'],
        rules: [{ type: 'block', rule: '||custom.example^' }],
      },
    });
    assert.equal(created.statusCode, 201);

    const audit = await app.inject({
      method: 'GET',
      url: '/api/profiles/audit1/audit',
      headers: { authorization: 'Bearer test-secret' },
    });
    assert.equal(audit.statusCode, 200);
    const auditBody = audit.json();
    assert.equal(auditBody.profile_id, 'audit1');
    assert.equal(auditBody.totals.active_categories, 2);
    assert.equal(auditBody.totals.manual_rules, 1);
    assert.equal(auditBody.totals.native_services, 41);
    assert.equal(auditBody.totals.file_rules, 8);
    assert.ok(auditBody.native_services.includes('youtube'));
    assert.equal(auditBody.sync.status, 'ok');
    assert.match(auditBody.filter_file, /audit1\.txt$/);

    const check = await app.inject({
      method: 'GET',
      url: '/api/profiles/audit1/check?domain=youtube.com&qtype=A',
      headers: { authorization: 'Bearer test-secret' },
    });
    assert.equal(check.statusCode, 200);
    const checkBody = check.json();
    assert.deepEqual(checkBody, {
      profile_id: 'audit1',
      domain: 'youtube.com',
      qtype: 'A',
      status: 'blocked',
      reason: 'FilteredBlockedService',
      service_name: 'YouTube',
      rule: '||youtube.com^',
      filter_id: 0,
      rules: [{ text: '||youtube.com^$client=audit1', filter_list_id: 0 }],
      checked_at: checkBody.checked_at,
    });

    const invalid = await app.inject({
      method: 'GET',
      url: '/api/profiles/audit1/check?domain=not-a-host&qtype=A',
      headers: { authorization: 'Bearer test-secret' },
    });
    assert.equal(invalid.statusCode, 400);
  });
});

test('syncs large cached blocklists without overflowing the stack', async () => {
  await withAppAndMock(async ({ app, mock }) => {
    const rules = Array.from({ length: 140_000 }, (_, index) => `||bulk-${index}.example^`);
    getDb().prepare(`
      INSERT INTO blocklist_cache (category, rules_json, refreshed_at, error)
      VALUES (?, ?, ?, ?)
    `).run('ads', JSON.stringify(rules), Date.now(), null);

    const response = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      headers: {
        authorization: 'Bearer test-secret',
        'content-type': 'application/json',
      },
      payload: {
        id: 'abc123',
        name: 'Pixel 8',
        categories: ['ads'],
      },
    });

    assert.equal(response.statusCode, 201);
    const filter = await app.inject({ method: 'GET', url: '/internal/profiles/abc123/filter.txt' });
    assert.equal(filter.statusCode, 200);
    assert.match(filter.body, /\|\|bulk-139999\.example\^\$client=abc123/);
  });
});

test('updates, reports status, and deletes a profile', async () => {
  await withAppAndMock(async ({ app }) => {
    const headers = {
      authorization: 'Bearer test-secret',
      'content-type': 'application/json',
    };

    const created = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      headers,
      payload: { id: 'abc123', name: 'Pixel 8' },
    });
    assert.equal(created.statusCode, 201);

    const updated = await app.inject({
      method: 'PUT',
      url: '/api/profiles/abc123',
      headers,
      payload: {
        active: false,
        categories: { ads: false, social_media: true },
      },
    });
    assert.equal(updated.statusCode, 200);
    assert.equal(updated.json().profile.active, false);

    const status = await app.inject({
      method: 'GET',
      url: '/api/status',
      headers: { authorization: 'Bearer test-secret' },
    });
    assert.equal(status.statusCode, 200);
    assert.equal(status.json().database.profiles, 1);
    assert.equal(status.json().database.active_profiles, 0);
    assert.equal(status.json().adguard.ok, true);
    assert.equal(status.json().sync.last_error, null);

    const deleted = await app.inject({
      method: 'DELETE',
      url: '/api/profiles/abc123',
      headers: { authorization: 'Bearer test-secret' },
    });
    assert.equal(deleted.statusCode, 204);

    const list = await app.inject({
      method: 'GET',
      url: '/api/profiles',
      headers: { authorization: 'Bearer test-secret' },
    });
    assert.deepEqual(list.json(), { profiles: [] });
  });
});

test('returns normalized query logs for a profile', async () => {
  await withAppAndMock(async ({ app }) => {
    const headers = {
      authorization: 'Bearer test-secret',
      'content-type': 'application/json',
    };

    const created = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      headers,
      payload: { id: 'abc123', name: 'Pixel 8' },
    });
    assert.equal(created.statusCode, 201);

    const logs = await app.inject({
      method: 'GET',
      url: '/api/profiles/abc123/logs?limit=20',
      headers: { authorization: 'Bearer test-secret' },
    });

    assert.equal(logs.statusCode, 200);
    assert.deepEqual(logs.json(), {
      profile_id: 'abc123',
      logs: [
        {
          time: '2026-06-12T19:00:22.932Z',
          domain: 'graph.facebook.com',
          type: 'A',
          client: '203.0.113.55',
          client_name: 'abc123',
          status: 'blocked',
          reason: 'FilteredBlackList',
          service_name: null,
          rule: '||facebook.com^$client=abc123',
          filter_id: 42,
        },
      ],
    });
  }, {
    queryLog: [
      {
        time: '2026-06-12T19:00:22.932Z',
        question: { name: 'graph.facebook.com', type: 'A' },
        client: '203.0.113.55',
        client_info: { name: 'abc123' },
        reason: 'FilteredBlackList',
        rule: '||facebook.com^$client=abc123',
        filterId: 42,
      },
      {
        time: '2026-06-12T19:00:23.100Z',
        question: { name: 'example.com', type: 'A' },
        client: '203.0.113.56',
        client_info: { name: 'other' },
        reason: 'NotFilteredNotFound',
      },
    ],
  });
});
