const jsonHeaders = {
  'content-type': 'application/json',
};

const managedRulesStart = '# gdns:managed:start';
const managedRulesEnd = '# gdns:managed:end';
const managedFilterNamePrefix = 'GDNS profile ';

export function profileFilterLocation(profileId) {
  const filtersDir = process.env.AGH_PROFILE_FILTERS_DIR || '/opt/adguardhome/profile-filters';
  return `${filtersDir.replace(/\/$/, '')}/${profileId}.txt`;
}

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

export async function getAdGuardQueryLog(limit = 100) {
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
  const response = await aghFetch(`/querylog?limit=${boundedLimit}`);
  const data = await response.json();

  return Array.isArray(data.data) ? data.data : [];
}

async function getFilteringStatus() {
  const response = await aghFetch('/filtering/status');
  return response.json();
}

function isMissingClientError(error) {
  return /client .*not found|not found/i.test(error.message);
}

function isMissingFilterError(error) {
  return /filter .*not found|url .*not found|does not exist|not exist|not found/i.test(error.message);
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
  const blockedServices = profile.active === false
    ? []
    : Array.isArray(profile.blocked_services) ? profile.blocked_services : [];

  const clientPayload = {
    name: profile.id,
    ids: [profile.id],
    use_global_settings: true,
    filtering_enabled: profile.active !== false,
    parental_enabled: false,
    safebrowsing_enabled: true,
    use_global_blocked_services: blockedServices.length === 0,
    blocked_services: blockedServices,
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

export async function removeAdGuardProfileFilter(profileId, location = profileFilterLocation(profileId)) {
  try {
    await aghFetch('/filtering/remove_url', {
      method: 'POST',
      body: JSON.stringify({
        url: location,
        whitelist: false,
      }),
    });
  } catch (error) {
    if (!isMissingFilterError(error)) {
      throw error;
    }
  }
}

export async function upsertAdGuardProfileFilter(profileId, location, active = true) {
  await removeAdGuardProfileFilter(profileId, location);

  if (!active) {
    return;
  }

  await aghFetch('/filtering/add_url', {
    method: 'POST',
    body: JSON.stringify({
      name: `${managedFilterNamePrefix}${profileId}`,
      url: location,
      whitelist: false,
    }),
  });
}

export async function refreshAdGuardFilters() {
  await aghFetch('/filtering/refresh', {
    method: 'POST',
    body: JSON.stringify({ whitelist: false }),
  });
}

export async function getAdGuardBlockedServices() {
  const response = await aghFetch('/blocked_services/all');
  const data = await response.json();
  const services = Array.isArray(data.blocked_services) ? data.blocked_services : [];

  return services.map((service) => ({
    id: service.id,
    name: service.name || service.id,
    group_id: service.group_id || null,
    rules: Array.isArray(service.rules) ? service.rules : [],
  }));
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

export async function clearManagedUserRules() {
  const status = await getFilteringStatus();
  const existingRules = Array.isArray(status.user_rules) ? status.user_rules : [];
  const rules = stripManagedRules(existingRules);

  if (rules.length === existingRules.length) {
    return;
  }

  await aghFetch('/filtering/set_rules', {
    method: 'POST',
    body: JSON.stringify({ rules }),
  });
}
