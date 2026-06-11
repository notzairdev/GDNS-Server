import { getCategorySummaries, refreshBlocklists } from '../services/blocklists.js';

export function registerBlocklistRoutes(app) {
  app.get('/api/blocklists/categories', async () => ({
    categories: getCategorySummaries(),
  }));

  app.post('/api/blocklists/refresh', async (request) => {
    const body = request.body || {};
    const results = await refreshBlocklists(body.category || null);

    return { results };
  });
}
