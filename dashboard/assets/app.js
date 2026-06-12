const state = {
  token: sessionStorage.getItem('gdns.apiToken') || '',
  profiles: [],
  categories: [],
  selectedId: null,
  selectedProfile: null,
  credentials: null,
  status: null,
};

const els = {
  tokenForm: document.querySelector('#token-form'),
  tokenInput: document.querySelector('#api-token'),
  refreshButton: document.querySelector('#refresh-button'),
  createForm: document.querySelector('#create-form'),
  detailForm: document.querySelector('#detail-form'),
  profilesList: document.querySelector('#profiles-list'),
  profileCount: document.querySelector('#profile-count'),
  selectedProfile: document.querySelector('#selected-profile'),
  emptyDetail: document.querySelector('#empty-detail'),
  categoriesList: document.querySelector('#categories-list'),
  credentialsBox: document.querySelector('#credentials-box'),
  syncBox: document.querySelector('#sync-box'),
  statusLine: document.querySelector('#status-line'),
  systemPill: document.querySelector('#system-pill'),
  statusProfiles: document.querySelector('#status-profiles'),
  statusActive: document.querySelector('#status-active'),
  statusBlocklists: document.querySelector('#status-blocklists'),
  statusAgh: document.querySelector('#status-agh'),
  refreshBlocklistsButton: document.querySelector('#refresh-blocklists-button'),
  syncButton: document.querySelector('#sync-button'),
  deleteButton: document.querySelector('#delete-button'),
  toast: document.querySelector('#toast'),
};

function authHeaders(extra = {}) {
  return {
    ...extra,
    authorization: `Bearer ${state.token}`,
  };
}

function showToast(message, type = 'info') {
  els.toast.textContent = message;
  els.toast.classList.toggle('error', type === 'error');
  els.toast.classList.remove('hidden');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.add('hidden'), 3500);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: authHeaders({
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    }),
  });

  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('API token invalido o ausente.');
    }

    const message = data?.message || data?.error || `HTTP ${response.status}`;
    throw new Error(message);
  }

  return data;
}

function ruleRowsFromTextarea(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(allow|block)\s+(.+)$/i);
      if (match) {
        return {
          type: match[1].toLowerCase(),
          rule: match[2].trim(),
        };
      }

      return {
        type: line.startsWith('@@') ? 'allow' : 'block',
        rule: line,
      };
    });
}

function rulesToTextarea(rules) {
  return rules.map((row) => `${row.type} ${row.rule}`).join('\n');
}

function renderProfiles() {
  els.profileCount.textContent = String(state.profiles.length);
  els.profilesList.replaceChildren();

  for (const profile of state.profiles) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `profile-row${profile.id === state.selectedId ? ' active' : ''}`;
    button.innerHTML = `
      <strong></strong>
      <span></span>
    `;
    button.querySelector('strong').textContent = profile.id;
    button.querySelector('span').textContent = profile.device_name || profile.name;
    button.addEventListener('click', () => selectProfile(profile.id));
    els.profilesList.append(button);
  }
}

function renderCategories() {
  els.categoriesList.replaceChildren();
  const enabled = new Map((state.selectedProfile?.categories || []).map((row) => [row.category, row.enabled]));

  for (const category of state.categories) {
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.name = 'categories';
    checkbox.value = category.id;
    checkbox.checked = enabled.get(category.id) ?? false;
    const span = document.createElement('span');
    span.textContent = category.name;
    label.append(checkbox, span);
    els.categoriesList.append(label);
  }
}

function renderDetail() {
  const profile = state.selectedProfile;
  els.selectedProfile.textContent = profile?.id || 'Ninguno';
  els.emptyDetail.classList.toggle('hidden', Boolean(profile));
  els.detailForm.classList.toggle('hidden', !profile);

  if (!profile) {
    els.credentialsBox.textContent = 'Selecciona un perfil.';
    return;
  }

  els.detailForm.elements.name.value = profile.name || '';
  els.detailForm.elements.device_name.value = profile.device_name || '';
  els.detailForm.elements.active.checked = profile.active;
  els.detailForm.elements.rules.value = rulesToTextarea(profile.rules || []);
  renderCategories();

  els.credentialsBox.textContent = JSON.stringify(state.credentials, null, 2);
}

function renderStatus() {
  const status = state.status;
  const ok = status?.ok === true;
  els.statusLine.textContent = status ? status.status : 'Sin estado';
  els.systemPill.textContent = status ? status.status : 'Pendiente';
  els.systemPill.className = `pill ${ok ? 'ok' : status ? 'degraded' : 'muted'}`;
  els.statusProfiles.textContent = String(status?.database?.profiles ?? 0);
  els.statusActive.textContent = String(status?.database?.active_profiles ?? 0);
  els.statusBlocklists.textContent = String(status?.database?.cached_blocklists ?? 0);
  els.statusAgh.textContent = status?.adguard?.ok ? 'ok' : 'degraded';
  els.syncBox.textContent = status?.sync?.last_error
    ? JSON.stringify(status.sync.last_error, null, 2)
    : 'Sin errores.';
}

async function loadStatus() {
  try {
    state.status = await api('/api/status');
  } catch (error) {
    state.status = {
      ok: false,
      status: 'degraded',
      database: {},
      adguard: { ok: false, error: error.message },
      sync: {},
    };
  }

  renderStatus();
}

async function loadProfiles() {
  const data = await api('/api/profiles');
  state.profiles = data.profiles;
  renderProfiles();
}

async function loadCategories() {
  const data = await api('/api/blocklists/categories');
  state.categories = data.categories;
}

async function selectProfile(id) {
  state.selectedId = id;
  const [profileData, credentials] = await Promise.all([
    api(`/api/profiles/${id}`),
    api(`/api/profiles/${id}/credentials`),
  ]);
  state.selectedProfile = profileData.profile;
  state.credentials = credentials;
  renderProfiles();
  renderDetail();
}

async function refreshAll() {
  if (!state.token) {
    showToast('Guarda el API token.', 'error');
    return;
  }

  try {
    await Promise.all([loadCategories(), loadProfiles(), loadStatus()]);
    if (state.selectedId) {
      await selectProfile(state.selectedId);
    } else {
      renderDetail();
    }
  } catch (error) {
    showToast(error.message, 'error');
  }
}

els.tokenInput.value = state.token;

els.tokenForm.addEventListener('submit', (event) => {
  event.preventDefault();
  state.token = els.tokenInput.value.trim();
  sessionStorage.setItem('gdns.apiToken', state.token);
  refreshAll();
});

els.refreshButton.addEventListener('click', refreshAll);

els.createForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(els.createForm);

  try {
    const created = await api('/api/profiles', {
      method: 'POST',
      body: JSON.stringify({
        id: form.get('id'),
        name: form.get('name'),
        device_name: form.get('device_name'),
      }),
    });
    els.createForm.reset();
    await refreshAll();
    await selectProfile(created.profile.id);
    showToast('Perfil creado.');
  } catch (error) {
    showToast(error.message, 'error');
  }
});

els.detailForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.selectedProfile) {
    return;
  }

  const categories = {};
  for (const checkbox of els.categoriesList.querySelectorAll('input[type="checkbox"]')) {
    categories[checkbox.value] = checkbox.checked;
  }

  try {
    await api(`/api/profiles/${state.selectedProfile.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: els.detailForm.elements.name.value,
        device_name: els.detailForm.elements.device_name.value,
        active: els.detailForm.elements.active.checked,
        categories,
        rules: ruleRowsFromTextarea(els.detailForm.elements.rules.value),
      }),
    });
    await refreshAll();
    showToast('Perfil guardado.');
  } catch (error) {
    showToast(error.message, 'error');
  }
});

els.syncButton.addEventListener('click', async () => {
  if (!state.selectedProfile) {
    return;
  }

  try {
    await api(`/api/profiles/${state.selectedProfile.id}/sync`, { method: 'POST' });
    await loadStatus();
    showToast('Perfil sincronizado.');
  } catch (error) {
    showToast(error.message, 'error');
  }
});

els.deleteButton.addEventListener('click', async () => {
  if (!state.selectedProfile) {
    return;
  }

  const id = state.selectedProfile.id;
  if (!window.confirm(`Eliminar ${id}?`)) {
    return;
  }

  try {
    await api(`/api/profiles/${id}`, { method: 'DELETE' });
    state.selectedId = null;
    state.selectedProfile = null;
    state.credentials = null;
    await refreshAll();
    showToast('Perfil eliminado.');
  } catch (error) {
    showToast(error.message, 'error');
  }
});

els.refreshBlocklistsButton.addEventListener('click', async () => {
  try {
    await api('/api/blocklists/refresh', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    await refreshAll();
    showToast('Blocklists actualizadas.');
  } catch (error) {
    showToast(error.message, 'error');
  }
});

if (state.token) {
  refreshAll();
}
