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
      role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('admin', 'editor')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS content (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK (type IN ('post', 'page')),
      title TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      body TEXT NOT NULL DEFAULT '',
      excerpt TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
      author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      published_at TEXT
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS content_tags (
      content_id INTEGER NOT NULL REFERENCES content(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (content_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  seed();
  return db;
}

function seed() {
  const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (userCount === 0) {
    const password = process.env.ADMIN_PASSWORD || 'admin123';
    db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(
      process.env.ADMIN_USERNAME || 'admin',
      bcrypt.hashSync(password, 10),
      'admin'
    );
    if (!process.env.ADMIN_PASSWORD) {
      console.log('Created default admin user — username: admin, password: admin123 (change it!)');
    }
  }

  const setting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  setting.run('site_title', 'My CMS');
  setting.run('site_description', 'A site powered by CMS');

  const contentCount = db.prepare('SELECT COUNT(*) AS n FROM content').get().n;
  if (contentCount === 0) {
    const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
    db.prepare(`
      INSERT INTO content (type, title, slug, body, excerpt, status, author_id, published_at)
      VALUES ('post', 'Welcome to your CMS', 'welcome-to-your-cms',
        '# Welcome\n\nThis is your first post. Log in to the [admin panel](/admin) to edit or delete it, and to start writing your own content.',
        'Your CMS is up and running.', 'published', ?, datetime('now'))
    `).run(admin ? admin.id : null);
  }
}

function getDb() {
  if (!db) throw new Error('Database not initialized — call init() first');
  return db;
}

/** Ensure a slug is unique in the content table, appending -2, -3, … if needed. */
function uniqueSlug(base, excludeId = null) {
  const candidateBase = slugify(base);
  let candidate = candidateBase;
  let i = 2;
  const stmt = excludeId
    ? db.prepare('SELECT 1 FROM content WHERE slug = ? AND id != ?')
    : db.prepare('SELECT 1 FROM content WHERE slug = ?');
  while (excludeId ? stmt.get(candidate, excludeId) : stmt.get(candidate)) {
    candidate = `${candidateBase}-${i++}`;
  }
  return candidate;
}

module.exports = { init, getDb, slugify, uniqueSlug };
