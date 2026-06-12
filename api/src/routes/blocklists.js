import { getCategorySummaries, refreshBlocklists } from '../services/blocklists.js';
import { refreshAdGuardFilters } from '../services/adguard.js';
import { writeActiveProfileFilterFiles } from './profiles.js';

export function registerBlocklistRoutes(app) {
  app.get('/api/blocklists/categories', async () => ({
    categories: getCategorySummaries(),
  }));

  app.post('/api/blocklists/refresh', async (request) => {
    const body = request.body || {};
    const results = await refreshBlocklists(body.category || null);
    await writeActiveProfileFilterFiles();
    await refreshAdGuardFilters();

    return { results };
  });
}
