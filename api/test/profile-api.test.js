import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import test from 'node:test';

import { buildApp } from '../src/app.js';
import { closeDb } from '../src/db/client.js';

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
  let userRules = ['||existing.example^'];

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
        response.end(JSON.stringify({ user_rules: userRules }));
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

    assert.ok(mock.calls.some((call) => call.url === '/control/clients/add'));
    assert.ok(mock.userRules.includes('# gdns:managed:start'));
    assert.ok(mock.userRules.includes('# gdns:managed:end'));
    assert.ok(mock.userRules.includes('||facebook.com^$client=abc123'));
    assert.ok(mock.userRules.includes('||example.org^$client=abc123'));
    assert.ok(mock.userRules.includes('@@||safe.example.org^$client=abc123'));
    assert.ok(mock.userRules.includes('||existing.example^'));
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
