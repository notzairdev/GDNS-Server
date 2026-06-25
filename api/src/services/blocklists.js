import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getDb } from '../db/client.js';

const categoriesPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'blocklists',
  'categories.json',
);

let cachedCategories;

export function readCategories() {
  if (!cachedCategories) {
    cachedCategories = JSON.parse(fs.readFileSync(categoriesPath, 'utf8'));
  }

  return cachedCategories;
}

function normalizeHostRule(host) {
  const cleanHost = host.toLowerCase().trim();
  if (!/^[a-z0-9.-]+$/.test(cleanHost) || cleanHost === 'localhost') {
    return null;
  }

  return `||${cleanHost}^`;
}

function normalizeRule(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('!') || trimmed.startsWith('#')) {
    return null;
  }

  const hostLine = trimmed.match(/^(?:0\.0\.0\.0|127\.0\.0\.1)\s+([a-z0-9.-]+)$/i);
  if (hostLine) {
    return normalizeHostRule(hostLine[1]);
  }

  if (/^[a-z0-9.-]+$/i.test(trimmed)) {
    return normalizeHostRule(trimmed);
  }

  return trimmed;
}

function uniqueRules(lines) {
  return [...new Set(lines.map(normalizeRule).filter(Boolean))];
}

export function categoryRulesFromConfig(categoryId) {
  const category = readCategories()[categoryId];
  if (!category) {
    return [];
  }

  return uniqueRules(category.manual_rules || []);
}

export function categoryBlockedServicesFromConfig(categoryId) {
  const category = readCategories()[categoryId];
  if (!category) {
    return [];
  }

  return [...new Set(category.blocked_services || [])];
}

export function getCategorySummaries() {
  const db = getDb();
  const cached = new Map(
    db.prepare('SELECT category, rules_json, refreshed_at, error FROM blocklist_cache').all()
      .map((row) => [row.category, row]),
  );

  return Object.entries(readCategories()).map(([id, category]) => {
    const cache = cached.get(id);
    const cachedRules = cache ? JSON.parse(cache.rules_json) : [];

    return {
      id,
      name: category.name,
      description: category.description,
      lists: category.lists || [],
      blocked_services: category.blocked_services || [],
      manual_rules: category.manual_rules || [],
      rules_count: cachedRules.length + (category.manual_rules || []).length,
      refreshed_at: cache?.refreshed_at || null,
      error: cache?.error || null,
    };
  });
}

export async function refreshBlocklists(categoryId = null) {
  const categories = readCategories();
  const ids = categoryId ? [categoryId] : Object.keys(categories);
  const results = [];

  for (const id of ids) {
    const category = categories[id];
    if (!category) {
      throw Object.assign(new Error(`Unknown blocklist category: ${id}`), { statusCode: 404 });
    }

    const rules = [];
    const errors = [];

    for (const listUrl of category.lists || []) {
      try {
        const response = await fetch(listUrl, { signal: AbortSignal.timeout(30_000) });
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`);
        }

        const text = await response.text();
        rules.push(...uniqueRules(text.split(/\r?\n/)));
      } catch (error) {
        errors.push(`${listUrl}: ${error.message}`);
      }
    }

    const unique = [...new Set(rules)];
    getDb().prepare(`
      INSERT INTO blocklist_cache (category, rules_json, refreshed_at, error)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(category) DO UPDATE SET
        rules_json = excluded.rules_json,
        refreshed_at = excluded.refreshed_at,
        error = excluded.error
    `).run(id, JSON.stringify(unique), Date.now(), errors.length ? errors.join('; ') : null);

    results.push({
      category: id,
      rules_count: unique.length,
      errors,
    });
  }

  return results;
}

export function getCachedCategoryRules(categoryId) {
  const row = getDb()
    .prepare('SELECT rules_json FROM blocklist_cache WHERE category = ?')
    .get(categoryId);

  return row ? JSON.parse(row.rules_json) : [];
}
