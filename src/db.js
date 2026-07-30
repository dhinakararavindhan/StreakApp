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

  // Role model: platform-level users.role is 'superadmin' (runs the
  // platform) or 'user'; company-level team_members.role is 'admin'
  // (company owner) or 'manager' (company employee).
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('superadmin', 'user')),
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
      role TEXT NOT NULL DEFAULT 'manager' CHECK (role IN ('admin', 'manager')),
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
      cover_image TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'published')),
      review_note TEXT NOT NULL DEFAULT '',
      published_snapshot TEXT NOT NULL DEFAULT '',
      locale TEXT NOT NULL DEFAULT 'en',
      translation_of INTEGER REFERENCES content(id) ON DELETE SET NULL,
      author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      published_at TEXT,
      publish_at TEXT,
      expire_at TEXT,
      UNIQUE (team_id, slug)
    );

    CREATE TABLE IF NOT EXISTS content_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_id INTEGER NOT NULL REFERENCES content(id) ON DELETE CASCADE,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      excerpt TEXT NOT NULL DEFAULT '',
      cover_image TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      edited_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_versions_content ON content_versions(content_id, id);

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      user_id INTEGER,
      username TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL,
      target TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_audit_team ON audit_log(team_id, id);

    CREATE TABLE IF NOT EXISTS webhooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      secret TEXT NOT NULL DEFAULT '',
      events TEXT NOT NULL DEFAULT '*',
      active INTEGER NOT NULL DEFAULT 1,
      last_status TEXT NOT NULL DEFAULT '',
      last_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      prefix TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      scope TEXT NOT NULL DEFAULT 'read' CHECK (scope IN ('read', 'write')),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      last_used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS content_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_id INTEGER NOT NULL REFERENCES content(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_comments_content ON content_comments(content_id, id);

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

  migrate();
  seed();
  return db;
}

/** Bring databases created under older schemas up to date. */
function migrate() {
  const tableSql = (name) =>
    (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) || {}).sql || '';

  // teams.custom_domain (pre-domain databases)
  if (!db.prepare('PRAGMA table_info(teams)').all().some((c) => c.name === 'custom_domain')) {
    db.exec('ALTER TABLE teams ADD COLUMN custom_domain TEXT');
  }
  db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_custom_domain ON teams(custom_domain) WHERE custom_domain IS NOT NULL'
  );

  // content.cover_image (pre-cover databases)
  if (!db.prepare('PRAGMA table_info(content)').all().some((c) => c.name === 'cover_image')) {
    db.exec("ALTER TABLE content ADD COLUMN cover_image TEXT NOT NULL DEFAULT ''");
  }

  // content.review_note (pre-approval databases)
  if (!db.prepare('PRAGMA table_info(content)').all().some((c) => c.name === 'review_note')) {
    db.exec("ALTER TABLE content ADD COLUMN review_note TEXT NOT NULL DEFAULT ''");
  }

  // content.published_snapshot — the still-live version while edits await review
  if (!db.prepare('PRAGMA table_info(content)').all().some((c) => c.name === 'published_snapshot')) {
    db.exec("ALTER TABLE content ADD COLUMN published_snapshot TEXT NOT NULL DEFAULT ''");
  }

  // Scheduled publishing and expiry (pre-scheduling databases)
  for (const col of ['publish_at', 'expire_at']) {
    if (!db.prepare('PRAGMA table_info(content)').all().some((c) => c.name === col)) {
      db.exec(`ALTER TABLE content ADD COLUMN ${col} TEXT`);
    }
  }

  // i18n (pre-locale databases)
  if (!db.prepare('PRAGMA table_info(content)').all().some((c) => c.name === 'locale')) {
    db.exec("ALTER TABLE content ADD COLUMN locale TEXT NOT NULL DEFAULT 'en'");
  }
  if (!db.prepare('PRAGMA table_info(content)').all().some((c) => c.name === 'translation_of')) {
    db.exec('ALTER TABLE content ADD COLUMN translation_of INTEGER REFERENCES content(id) ON DELETE SET NULL');
  }

  // Approval workflow: the old status CHECK lacks 'pending', which blocks
  // submissions on existing databases — rebuild the content table.
  if (!tableSql('content').includes("'pending'")) {
    db.pragma('foreign_keys = OFF');
    db.exec(`
      CREATE TABLE content_migrated (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('post', 'page')),
        title TEXT NOT NULL,
        slug TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        excerpt TEXT NOT NULL DEFAULT '',
        cover_image TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'published')),
        review_note TEXT NOT NULL DEFAULT '',
        published_snapshot TEXT NOT NULL DEFAULT '',
        author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        published_at TEXT,
        UNIQUE (team_id, slug)
      );
      INSERT INTO content_migrated (id, team_id, type, title, slug, body, excerpt, cover_image, status, review_note, published_snapshot, author_id, created_at, updated_at, published_at)
        SELECT id, team_id, type, title, slug, body, excerpt, cover_image, status, review_note, published_snapshot, author_id, created_at, updated_at, published_at
        FROM content;
      DROP TABLE content;
      ALTER TABLE content_migrated RENAME TO content;
    `);
    db.pragma('foreign_keys = ON');
  }

  // Role vocabulary: platform admin -> superadmin. Old CHECK constraints
  // block in-place updates, so rebuild the table.
  if (!tableSql('users').includes("'superadmin'")) {
    db.pragma('foreign_keys = OFF');
    db.exec(`
      CREATE TABLE users_migrated (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('superadmin', 'user')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO users_migrated (id, username, password_hash, role, created_at)
        SELECT id, username, password_hash,
               CASE WHEN role = 'admin' THEN 'superadmin' ELSE 'user' END,
               created_at
        FROM users;
      DROP TABLE users;
      ALTER TABLE users_migrated RENAME TO users;
    `);
    db.pragma('foreign_keys = ON');
  }

  // Role vocabulary: owner -> admin, editor -> manager.
  if (tableSql('team_members').includes("'owner'")) {
    db.pragma('foreign_keys = OFF');
    db.exec(`
      CREATE TABLE team_members_migrated (
        team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'manager' CHECK (role IN ('admin', 'manager')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (team_id, user_id)
      );
      INSERT INTO team_members_migrated (team_id, user_id, role, created_at)
        SELECT team_id, user_id,
               CASE WHEN role = 'owner' THEN 'admin' ELSE 'manager' END,
               created_at
        FROM team_members;
      DROP TABLE team_members;
      ALTER TABLE team_members_migrated RENAME TO team_members;
    `);
    db.pragma('foreign_keys = ON');
  }
}

function seed() {
  const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (userCount === 0) {
    const password = process.env.ADMIN_PASSWORD || 'admin123';
    const result = db
      .prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
      .run(process.env.ADMIN_USERNAME || 'admin', bcrypt.hashSync(password, 10), 'superadmin');
    if (!process.env.ADMIN_PASSWORD) {
      console.log('Created default superadmin — username: admin, password: admin123 (change it!)');
    }

    const team = db.prepare('INSERT INTO teams (name, slug) VALUES (?, ?)').run('My Company', 'my-company');
    db.prepare('INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)').run(
      team.lastInsertRowid,
      result.lastInsertRowid,
      'admin'
    );
    setTeamDefaults(team.lastInsertRowid, 'My Company');
    db.prepare(`
      INSERT INTO content (team_id, type, title, slug, body, excerpt, status, author_id, published_at)
      VALUES (?, 'post', 'Welcome to Nova', 'welcome-to-nova',
        '# Welcome\n\nThis is your company''s first post. Open the [admin panel](/admin) to edit it, invite your team, brand your site, and start publishing.',
        'Your company site is live.', 'published', ?, datetime('now'))
    `).run(team.lastInsertRowid, result.lastInsertRowid);
  }

  const setting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  setting.run('site_title', 'Nova');
  setting.run('site_description', 'The multi-company content platform');
  setting.run('allow_registration', 'true');
}

/** Seed default per-company settings; used at company creation. */
function setTeamDefaults(teamId, name) {
  const stmt = db.prepare('INSERT OR IGNORE INTO team_settings (team_id, key, value) VALUES (?, ?, ?)');
  stmt.run(teamId, 'site_title', name);
  stmt.run(teamId, 'site_description', `${name} on Nova`);
  stmt.run(teamId, 'default_locale', 'en');
}

function getDb() {
  if (!db) throw new Error('Database not initialized — call init() first');
  return db;
}

/** Ensure a content slug is unique within a company, appending -2, -3, … if needed. */
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

/** Ensure a company slug is unique, appending -2, -3, … if needed. */
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
