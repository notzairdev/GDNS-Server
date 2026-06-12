const jsonHeaders = {
  'content-type': 'application/json',
};

const managedRulesStart = '# gdns:managed:start';
const managedRulesEnd = '# gdns:managed:end';

function authHeader() {
  const user = process.env.AGH_USER;
  const pass = process.env.AGH_PASS;
  if (!user || !pass) {
    throw Object.assign(new Error('AGH_USER and AGH_PASS are required'), { statusCode: 500 });
  }

  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

async function aghFetch(path, options = {}) {
  const baseUrl = process.env.AGH_INTERNAL_URL || 'http://adguardhome:3000';
  const response = await fetch(`${baseUrl}/control${path}`, {
    ...options,
    headers: {
      ...jsonHeaders,
      authorization: authHeader(),
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw Object.assign(new Error(`AdGuardHome API failed: ${response.status} ${text}`), {
      statusCode: 502,
    });
  }

  return response;
}

export async function getAdGuardHealth() {
  try {
    const response = await aghFetch('/status');
    const status = await response.json().catch(() => ({}));

    return {
      ok: true,
      protection_enabled: status.protection_enabled ?? null,
      running: status.running ?? null,
      version: status.version ?? null,
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
    };
  }
}

function isMissingClientError(error) {
  return /client .*not found|not found/i.test(error.message);
}

async function addAdGuardClient(clientPayload) {
  await aghFetch('/clients/add', {
    method: 'POST',
    body: JSON.stringify(clientPayload),
  });
}

async function updateAdGuardClient(profileId, clientPayload) {
  await aghFetch('/clients/update', {
    method: 'POST',
    body: JSON.stringify({
      name: profileId,
      data: clientPayload,
    }),
  });
}

function isPersistentClientMatch(client, profileId) {
  return client?.name === profileId || (Array.isArray(client?.ids) && client.ids.includes(profileId));
}

export async function ensureAdGuardClient(profile) {
  const clientPayload = {
    name: profile.id,
    ids: [profile.id],
    use_global_settings: true,
    filtering_enabled: profile.active !== false,
    parental_enabled: false,
    safebrowsing_enabled: true,
    use_global_blocked_services: true,
    blocked_services: [],
    tags: [],
  };

  const clientsResponse = await aghFetch('/clients');
  const clientsData = await clientsResponse.json();
  const persistentClients = Array.isArray(clientsData.clients) ? clientsData.clients : [];
  const found = persistentClients.some((client) => isPersistentClientMatch(client, profile.id));

  if (found) {
    try {
      await updateAdGuardClient(profile.id, clientPayload);
    } catch (error) {
      if (!isMissingClientError(error)) {
        throw error;
      }

      await addAdGuardClient(clientPayload);
    }
    return;
  }

  await addAdGuardClient(clientPayload);
}

export async function deleteAdGuardClient(profileId) {
  await aghFetch('/clients/delete', {
    method: 'POST',
    body: JSON.stringify({ name: profileId }),
  });
}

function stripManagedRules(rules) {
  const kept = [];
  let inManagedBlock = false;

  for (const rule of rules) {
    if (rule === managedRulesStart) {
      inManagedBlock = true;
      continue;
    }

    if (rule === managedRulesEnd) {
      inManagedBlock = false;
      continue;
    }

    if (!inManagedBlock) {
      kept.push(rule);
    }
  }

  return kept;
}

export async function replaceManagedRules(managedRules) {
  const statusResponse = await aghFetch('/filtering/status');
  const status = await statusResponse.json();
  const existingRules = Array.isArray(status.user_rules) ? status.user_rules : [];
  const rules = [
    ...stripManagedRules(existingRules),
    managedRulesStart,
    ...managedRules,
    managedRulesEnd,
  ];

  await aghFetch('/filtering/set_rules', {
    method: 'POST',
    body: JSON.stringify({ rules }),
  });
}
