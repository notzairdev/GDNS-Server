CREATE TABLE IF NOT EXISTS profiles (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  device_name TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS profile_categories (
  profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  category    TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (profile_id, category)
);

CREATE TABLE IF NOT EXISTS profile_rules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  rule        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK(type IN ('block', 'allow')),
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id  TEXT,
  action      TEXT NOT NULL,
  status      TEXT NOT NULL,
  message     TEXT,
  created_at  INTEGER NOT NULL
);
