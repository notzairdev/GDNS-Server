import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

let db;

export function getDb() {
  if (!db) {
    initDb();
  }

  return db;
}

export function initDb() {
  if (db) {
    return db;
  }

  const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'data', 'profiles.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql');
  db.exec(fs.readFileSync(schemaPath, 'utf8'));

  return db;
}
