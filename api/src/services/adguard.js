const jsonHeaders = {
  'content-type': 'application/json',
};

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

export async function ensureAdGuardClient(profile) {
  const clientPayload = {
    name: profile.id,
    ids: [profile.id],
    use_global_settings: true,
    filtering_enabled: true,
    parental_enabled: false,
    safebrowsing_enabled: true,
    use_global_blocked_services: true,
    blocked_services: [],
    tags: [],
  };

  const search = await aghFetch('/clients/search', {
    method: 'POST',
    body: JSON.stringify({ clients: [{ id: profile.id }] }),
  });
  const existing = await search.json();
  const found = Array.isArray(existing) && existing.some((entry) => entry[profile.id]);

  if (found) {
    await aghFetch('/clients/update', {
      method: 'POST',
      body: JSON.stringify({
        name: profile.id,
        data: clientPayload,
      }),
    });
    return;
  }

  await aghFetch('/clients/add', {
    method: 'POST',
    body: JSON.stringify(clientPayload),
  });
}
