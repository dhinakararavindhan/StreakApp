const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

let db;

function slugify(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'untitled';
}

function init(options = {}) {
  const dataDir = options.dataDir || DATA_DIR;
  fs.mkdirSync(dataDir, { recursive: true });
  const file = options.memory ? ':memory:' : path.join(dataDir, 'cms.sqlite');
  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      custom_domain TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS team_members (
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('owner', 'editor')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (team_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS content (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('post', 'page')),
      title TEXT NOT NULL,
      slug TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      excerpt TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
      author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      published_at TEXT,
      UNIQUE (team_id, slug)
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      UNIQUE (team_id, slug)
    );

    CREATE TABLE IF NOT EXISTS content_tags (
      content_id INTEGER NOT NULL REFERENCES content(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (content_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS team_settings (
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (team_id, key)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Migration for databases created before custom domains existed.
  const teamCols = db.prepare('PRAGMA table_info(teams)').all();
  if (!teamCols.some((c) => c.name === 'custom_domain')) {
    db.exec('ALTER TABLE teams ADD COLUMN custom_domain TEXT');
  }
  db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_custom_domain ON teams(custom_domain) WHERE custom_domain IS NOT NULL'
  );

  seed();
  return db;
}

function seed() {
  const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (userCount === 0) {
    const password = process.env.ADMIN_PASSWORD || 'admin123';
    const result = db
      .prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
      .run(process.env.ADMIN_USERNAME || 'admin', bcrypt.hashSync(password, 10), 'admin');
    if (!process.env.ADMIN_PASSWORD) {
      console.log('Created default admin user — username: admin, password: admin123 (change it!)');
    }

    // Give the first admin a starter team with a welcome post.
    const team = db.prepare('INSERT INTO teams (name, slug) VALUES (?, ?)').run('My Team', 'my-team');
    db.prepare('INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)').run(
      team.lastInsertRowid,
      result.lastInsertRowid,
      'owner'
    );
    setTeamDefaults(team.lastInsertRowid, 'My Team');
    db.prepare(`
      INSERT INTO content (team_id, type, title, slug, body, excerpt, status, author_id, published_at)
      VALUES (?, 'post', 'Welcome to your CMS', 'welcome-to-your-cms',
        '# Welcome\n\nThis is your team''s first post. Log in to the [admin panel](/admin) to edit or delete it, and to start publishing your own content.',
        'Your team site is up and running.', 'published', ?, datetime('now'))
    `).run(team.lastInsertRowid, result.lastInsertRowid);
  }

  const setting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  setting.run('site_title', 'CMS');
  setting.run('site_description', 'A multi-team content platform');
  setting.run('allow_registration', 'true');
}

/** Seed default per-team settings; used at team creation. */
function setTeamDefaults(teamId, name) {
  const stmt = db.prepare('INSERT OR IGNORE INTO team_settings (team_id, key, value) VALUES (?, ?, ?)');
  stmt.run(teamId, 'site_title', name);
  stmt.run(teamId, 'site_description', `${name} on CMS`);
}

function getDb() {
  if (!db) throw new Error('Database not initialized — call init() first');
  return db;
}

/** Ensure a content slug is unique within a team, appending -2, -3, … if needed. */
function uniqueSlug(base, teamId, excludeId = null) {
  const candidateBase = slugify(base);
  let candidate = candidateBase;
  let i = 2;
  const stmt = excludeId
    ? db.prepare('SELECT 1 FROM content WHERE team_id = ? AND slug = ? AND id != ?')
    : db.prepare('SELECT 1 FROM content WHERE team_id = ? AND slug = ?');
  while (excludeId ? stmt.get(teamId, candidate, excludeId) : stmt.get(teamId, candidate)) {
    candidate = `${candidateBase}-${i++}`;
  }
  return candidate;
}

/** Ensure a team slug is unique, appending -2, -3, … if needed. */
function uniqueTeamSlug(base, excludeId = null) {
  const candidateBase = slugify(base);
  let candidate = candidateBase;
  let i = 2;
  const stmt = excludeId
    ? db.prepare('SELECT 1 FROM teams WHERE slug = ? AND id != ?')
    : db.prepare('SELECT 1 FROM teams WHERE slug = ?');
  while (excludeId ? stmt.get(candidate, excludeId) : stmt.get(candidate)) {
    candidate = `${candidateBase}-${i++}`;
  }
  return candidate;
}

module.exports = { init, getDb, slugify, uniqueSlug, uniqueTeamSlug, setTeamDefaults };
