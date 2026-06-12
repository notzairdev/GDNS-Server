import {
  categoryBlockedServicesFromConfig,
  categoryRulesFromConfig,
  getCachedCategoryRules,
  getCategorySummaries,
  readCategories,
  refreshBlocklists,
} from '../services/blocklists.js';
import { getAdGuardBlockedServices, refreshAdGuardFilters } from '../services/adguard.js';
import { writeActiveProfileFilterFiles } from './profiles.js';

export function registerBlocklistRoutes(app) {
  app.get('/api/blocklists/categories', async () => ({
    categories: getCategorySummaries(),
  }));

  app.get('/api/blocklists/categories/:id/rules', async (request, reply) => {
    const categoryId = String(request.params.id || '');
    const category = readCategories()[categoryId];
    if (!category) {
      reply.status(404).send({ error: 'not_found' });
      return;
    }

    const limit = Math.max(50, Math.min(Number(request.query?.limit || 300), 1000));
    const offset = Math.max(0, Number(request.query?.offset || 0));
    const cachedRules = getCachedCategoryRules(categoryId);
    const manualRules = categoryRulesFromConfig(categoryId);
    const fileRules = [...manualRules, ...cachedRules];
    const blockedServiceIds = categoryBlockedServicesFromConfig(categoryId);

    let blockedServices = blockedServiceIds.map((id) => ({
      id,
      name: id,
      group_id: null,
      rules: [],
    }));

    try {
      const services = await getAdGuardBlockedServices();
      const serviceMap = new Map(services.map((service) => [service.id, service]));
      blockedServices = blockedServiceIds.map((id) => serviceMap.get(id) || {
        id,
        name: id,
        group_id: null,
        rules: [],
      });
    } catch (error) {
      request.log.warn({ error }, 'unable to load blocked service rules');
    }

    return {
      category: {
        id: categoryId,
        name: category.name,
        description: category.description,
      },
      file_rules: {
        total: fileRules.length,
        offset,
        limit,
        rules: fileRules.slice(offset, offset + limit),
      },
      blocked_services: blockedServices,
    };
  });

  app.post('/api/blocklists/refresh', async (request) => {
    const body = request.body || {};
    const results = await refreshBlocklists(body.category || null);
    await writeActiveProfileFilterFiles();
    await refreshAdGuardFilters();

    return { results };
  });
}
