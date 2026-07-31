const crypto = require('crypto');
const express = require('express');
const multer = require('multer');

const { getDb, uniqueTeamSlug, setTeamDefaults, slugify } = require('../db');
const { audit } = require('../audit');
const { requireAuth, requireTeamRole } = require('../auth');
const { getTemplate, applySite, normalizeSite } = require('../templates');
const { listTypes, normalizeSchema, parseFieldValues, BUILTIN_TYPES, FIELD_KINDS } = require('../content-types');
const { aiAvailable, generateSite } = require('../ai');
const { insertItem, parseWxr, parseMarkdown, importNovaExport } = require('../importers');
const { rateLimit } = require('../security');
const contentRoutes = require('./content');
const tagRoutes = require('./tags');
const mediaRoutes = require('./media');

const router = express.Router();

const TEAM_SETTING_KEYS = new Set([
  'site_title',
  'site_description',
  'theme',
  'accent_color',
  'custom_css',
  'default_locale',
  'heading_font',
  'layout',
  'nav_links',
]);

const DOMAIN_RE = /^(?=.{4,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

function serialize(team) {
  const db = getDb();
  const members = db.prepare('SELECT COUNT(*) AS n FROM team_members WHERE team_id = ?').get(team.id).n;
  const content = db.prepare('SELECT COUNT(*) AS n FROM content WHERE team_id = ?').get(team.id).n;
  return { ...team, member_count: members, content_count: content };
}

// My companies (superadmins see all).
router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const rows =
    req.user.role === 'superadmin'
      ? db.prepare("SELECT t.*, 'admin' AS my_role FROM teams t ORDER BY t.name").all()
      : db
          .prepare(
            `SELECT t.*, tm.role AS my_role FROM teams t
             JOIN team_members tm ON tm.team_id = t.id
             WHERE tm.user_id = ? ORDER BY t.name`
          )
          .all(req.user.id);
  res.json(rows.map(serialize));
});

// Any authenticated user can create a company; they become its admin.
router.post('/', requireAuth, (req, res) => {
  const { name, slug } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
  const db = getDb();
  const finalSlug = uniqueTeamSlug(slug || name);
  const result = db.prepare('INSERT INTO teams (name, slug) VALUES (?, ?)').run(String(name).trim(), finalSlug);
  db.prepare('INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)').run(
    result.lastInsertRowid,
    req.user.id,
    'admin'
  );
  setTeamDefaults(result.lastInsertRowid, String(name).trim());
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ ...serialize(team), my_role: 'admin' });
});

router.get('/:teamId', requireTeamRole('manager'), (req, res) => {
  res.json({ ...serialize(req.team), my_role: req.teamRole });
});

router.put('/:teamId', requireTeamRole('admin'), (req, res) => {
  const { name, slug, custom_domain } = req.body || {};
  const db = getDb();
  const newName = name !== undefined && String(name).trim() ? String(name).trim() : req.team.name;
  const newSlug = slug !== undefined || name !== undefined
    ? uniqueTeamSlug(slug || newName, req.team.id)
    : req.team.slug;

  let newDomain = req.team.custom_domain;
  if (custom_domain !== undefined) {
    const domain = String(custom_domain).trim().toLowerCase();
    if (!domain) {
      newDomain = null;
    } else {
      if (!DOMAIN_RE.test(domain)) {
        return res.status(400).json({ error: 'custom_domain must be a valid hostname like www.example.com' });
      }
      const taken = db
        .prepare('SELECT 1 FROM teams WHERE custom_domain = ? AND id != ?')
        .get(domain, req.team.id);
      if (taken) return res.status(409).json({ error: 'That domain is already connected to another company' });
      newDomain = domain;
    }
  }

  db.prepare('UPDATE teams SET name = ?, slug = ?, custom_domain = ? WHERE id = ?').run(
    newName,
    newSlug,
    newDomain,
    req.team.id
  );
  audit(req.team.id, req.user, 'company.update', newName, newDomain ? `domain: ${newDomain}` : '');
  res.json(serialize(db.prepare('SELECT * FROM teams WHERE id = ?').get(req.team.id)));
});

router.delete('/:teamId', requireTeamRole('admin'), (req, res) => {
  getDb().prepare('DELETE FROM teams WHERE id = ?').run(req.team.id);
  res.json({ ok: true });
});

// ---------- site templates + AI site builder ----------

// Apply a pre-configured starter kit: theme settings + published starter
// pages and posts. Admin-only — inserting published content is an admin right.
router.post('/:teamId/apply-template', requireTeamRole('admin'), (req, res) => {
  const template = getTemplate(String((req.body || {}).template || ''));
  if (!template) return res.status(400).json({ error: 'Unknown template' });
  const result = applySite(req.team.id, template, req.user);
  audit(req.team.id, req.user, 'site.template', template.name, `${result.created} items`);
  res.json({ ok: true, template: template.key, ...result });
});

// Describe the company; Claude designs the theme and writes the starter site.
const aiLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, name: 'AI builds' });
router.post('/:teamId/ai-build', requireTeamRole('admin'), aiLimiter, async (req, res, next) => {
  try {
    if (!aiAvailable()) {
      return res.status(503).json({
        error: 'AI builder is not configured — set ANTHROPIC_API_KEY on the server to enable it',
      });
    }
    const prompt = String((req.body || {}).prompt || '').trim();
    if (prompt.length < 8) {
      return res.status(400).json({ error: 'Describe your company in a sentence or two' });
    }
    let spec;
    try {
      spec = normalizeSite(await generateSite(prompt.slice(0, 1000)));
    } catch (err) {
      return res.status(502).json({ error: `AI generation failed: ${err.message}` });
    }
    if (!spec.site_title) delete spec.site_title;
    if (!spec.site_description) delete spec.site_description;
    const result = applySite(req.team.id, spec, req.user);
    audit(req.team.id, req.user, 'site.ai_build', spec.site_title || req.team.name, `${result.created} items`);
    res.json({
      ok: true,
      site_title: spec.site_title || req.team.name,
      theme: spec.theme,
      heading_font: spec.heading_font,
      layout: spec.layout,
      accent_color: spec.accent_color,
      pages: spec.pages.length,
      posts: spec.posts.length,
      items: spec.items.length,
      ...result,
    });
  } catch (err) {
    next(err);
  }
});

// ---------- dashboard stats ----------

router.get('/:teamId/stats', requireTeamRole('manager'), (req, res) => {
  const db = getDb();
  const one = (sql) => db.prepare(sql).get(req.team.id).n;
  res.json({
    posts: one("SELECT COUNT(*) AS n FROM content WHERE team_id = ? AND type = 'post' AND deleted_at IS NULL"),
    pages: one("SELECT COUNT(*) AS n FROM content WHERE team_id = ? AND type = 'page' AND deleted_at IS NULL"),
    published: one("SELECT COUNT(*) AS n FROM content WHERE team_id = ? AND status = 'published' AND deleted_at IS NULL"),
    drafts: one("SELECT COUNT(*) AS n FROM content WHERE team_id = ? AND status = 'draft' AND deleted_at IS NULL"),
    pending: one("SELECT COUNT(*) AS n FROM content WHERE team_id = ? AND status = 'pending' AND deleted_at IS NULL"),
    trash: one('SELECT COUNT(*) AS n FROM content WHERE team_id = ? AND deleted_at IS NOT NULL'),
    inbox: one('SELECT COUNT(*) AS n FROM form_submissions WHERE team_id = ?'),
    media: one('SELECT COUNT(*) AS n FROM media WHERE team_id = ?'),
    members: one('SELECT COUNT(*) AS n FROM team_members WHERE team_id = ?'),
    tags: one('SELECT COUNT(*) AS n FROM tags WHERE team_id = ?'),
    recent: db
      .prepare(
        `SELECT c.id, c.title, c.type, c.status, c.updated_at, u.username AS author
         FROM content c LEFT JOIN users u ON u.id = c.author_id
         WHERE c.team_id = ? AND c.deleted_at IS NULL ORDER BY c.updated_at DESC LIMIT 6`
      )
      .all(req.team.id),
  });
});

// ---------- audit log ----------

router.get('/:teamId/audit', requireTeamRole('admin'), (req, res) => {
  const rows = getDb()
    .prepare(
      'SELECT id, username, action, target, detail, created_at FROM audit_log WHERE team_id = ? ORDER BY id DESC LIMIT 100'
    )
    .all(req.team.id);
  res.json(rows);
});

// ---------- members ----------

router.get('/:teamId/members', requireTeamRole('manager'), (req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT u.id, u.username, tm.role, tm.created_at FROM team_members tm
       JOIN users u ON u.id = tm.user_id WHERE tm.team_id = ? ORDER BY u.username`
    )
    .all(req.team.id);
  res.json(rows);
});

// Add a member by username (they must already have an account).
router.post('/:teamId/members', requireTeamRole('admin'), (req, res) => {
  const { username, role = 'manager' } = req.body || {};
  if (!username) return res.status(400).json({ error: 'username is required' });
  if (!['admin', 'manager'].includes(role)) {
    return res.status(400).json({ error: 'role must be admin or manager' });
  }
  const db = getDb();
  const user = db.prepare('SELECT id, username FROM users WHERE username = ?').get(username);
  if (!user) return res.status(404).json({ error: `No account named "${username}" — they need to register first` });
  if (db.prepare('SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?').get(req.team.id, user.id)) {
    return res.status(409).json({ error: 'Already a member of this company' });
  }
  db.prepare('INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)').run(req.team.id, user.id, role);
  audit(req.team.id, req.user, 'member.add', user.username, role);
  res.status(201).json({ id: user.id, username: user.username, role });
});

router.put('/:teamId/members/:userId', requireTeamRole('admin'), (req, res) => {
  const { role } = req.body || {};
  if (!['admin', 'manager'].includes(role)) {
    return res.status(400).json({ error: 'role must be admin or manager' });
  }
  const db = getDb();
  if (role === 'manager' && wouldRemoveLastAdmin(db, req.team.id, Number(req.params.userId))) {
    return res.status(400).json({ error: 'A company must keep at least one admin' });
  }
  const result = db
    .prepare('UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?')
    .run(role, req.team.id, req.params.userId);
  if (result.changes === 0) return res.status(404).json({ error: 'Not a member' });
  audit(req.team.id, req.user, 'member.role', `user #${req.params.userId}`, role);
  res.json({ ok: true });
});

// Admins can remove anyone; members can remove themselves (leave).
router.delete('/:teamId/members/:userId', requireTeamRole('manager'), (req, res) => {
  const targetId = Number(req.params.userId);
  const isSelf = targetId === req.user.id;
  if (!isSelf && req.teamRole !== 'admin') {
    return res.status(403).json({ error: 'Company admin access required' });
  }
  const db = getDb();
  if (wouldRemoveLastAdmin(db, req.team.id, targetId)) {
    return res.status(400).json({ error: 'A company must keep at least one admin' });
  }
  const result = db
    .prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?')
    .run(req.team.id, targetId);
  if (result.changes === 0) return res.status(404).json({ error: 'Not a member' });
  audit(req.team.id, req.user, isSelf ? 'member.leave' : 'member.remove', `user #${targetId}`);
  res.json({ ok: true });
});

function wouldRemoveLastAdmin(db, teamId, userId) {
  const target = db
    .prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?')
    .get(teamId, userId);
  if (!target || target.role !== 'admin') return false;
  const admins = db
    .prepare("SELECT COUNT(*) AS n FROM team_members WHERE team_id = ? AND role = 'admin'")
    .get(teamId).n;
  return admins <= 1;
}

// ---------- company settings ----------

router.get('/:teamId/settings', requireTeamRole('manager'), (req, res) => {
  const rows = getDb()
    .prepare('SELECT key, value FROM team_settings WHERE team_id = ?')
    .all(req.team.id);
  res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
});

router.put('/:teamId/settings', requireTeamRole('admin'), (req, res) => {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO team_settings (team_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(team_id, key) DO UPDATE SET value = excluded.value`
  );
  const changed = [];
  for (const [key, value] of Object.entries(req.body || {})) {
    if (TEAM_SETTING_KEYS.has(key)) {
      stmt.run(req.team.id, key, String(value));
      changed.push(key);
    }
  }
  if (changed.length) audit(req.team.id, req.user, 'settings.update', changed.join(', '));
  const rows = db.prepare('SELECT key, value FROM team_settings WHERE team_id = ?').all(req.team.id);
  res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
});

// ---------- webhooks (company admins) ----------

const EVENT_NAMES = ['content.published', 'content.updated', 'content.unpublished', 'content.deleted', 'form.submission'];

router.get('/:teamId/webhooks', requireTeamRole('admin'), (req, res) => {
  const rows = getDb()
    .prepare('SELECT id, url, events, active, last_status, last_at, created_at FROM webhooks WHERE team_id = ? ORDER BY id')
    .all(req.team.id);
  res.json(rows);
});

router.post('/:teamId/webhooks', requireTeamRole('admin'), (req, res) => {
  const { url, events = '*', secret } = req.body || {};
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    return res.status(400).json({ error: 'url must be a valid http(s) URL' });
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return res.status(400).json({ error: 'url must be http or https' });
  }
  const eventList = String(events).trim() || '*';
  if (eventList !== '*') {
    const bad = eventList.split(',').map((e) => e.trim()).find((e) => !EVENT_NAMES.includes(e));
    if (bad) return res.status(400).json({ error: `Unknown event "${bad}" — use ${EVENT_NAMES.join(', ')} or *` });
  }
  const finalSecret = secret ? String(secret) : crypto.randomBytes(16).toString('hex');
  const result = getDb()
    .prepare('INSERT INTO webhooks (team_id, url, secret, events) VALUES (?, ?, ?, ?)')
    .run(req.team.id, String(url), finalSecret, eventList);
  audit(req.team.id, req.user, 'webhook.add', String(url), eventList);
  // The signing secret is returned once, at creation.
  res.status(201).json({ id: result.lastInsertRowid, url: String(url), events: eventList, secret: finalSecret });
});

router.delete('/:teamId/webhooks/:hookId', requireTeamRole('admin'), (req, res) => {
  const result = getDb()
    .prepare('DELETE FROM webhooks WHERE id = ? AND team_id = ?')
    .run(req.params.hookId, req.team.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  audit(req.team.id, req.user, 'webhook.remove', `#${req.params.hookId}`);
  res.json({ ok: true });
});

// ---------- API keys (company admins) ----------

router.get('/:teamId/api-keys', requireTeamRole('admin'), (req, res) => {
  const rows = getDb()
    .prepare('SELECT id, name, prefix, scope, last_used_at, created_at FROM api_keys WHERE team_id = ? ORDER BY id')
    .all(req.team.id);
  res.json(rows);
});

router.post('/:teamId/api-keys', requireTeamRole('admin'), (req, res) => {
  const { name, scope = 'read' } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
  if (!['read', 'write'].includes(scope)) return res.status(400).json({ error: 'scope must be read or write' });
  const token = `nova_${crypto.randomBytes(24).toString('hex')}`;
  const result = getDb()
    .prepare('INSERT INTO api_keys (team_id, name, prefix, token_hash, scope, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(
      req.team.id,
      String(name).trim(),
      token.slice(0, 13),
      crypto.createHash('sha256').update(token).digest('hex'),
      scope,
      req.user.id
    );
  audit(req.team.id, req.user, 'apikey.create', String(name).trim(), scope);
  // The full token is returned once, at creation — only its hash is stored.
  res.status(201).json({ id: result.lastInsertRowid, name: String(name).trim(), scope, token });
});

router.delete('/:teamId/api-keys/:keyId', requireTeamRole('admin'), (req, res) => {
  const result = getDb()
    .prepare('DELETE FROM api_keys WHERE id = ? AND team_id = ?')
    .run(req.params.keyId, req.team.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  audit(req.team.id, req.user, 'apikey.revoke', `#${req.params.keyId}`);
  res.json({ ok: true });
});

// ---------- custom content types ----------

router.get('/:teamId/content-types', requireTeamRole('manager'), (req, res) => {
  res.json(listTypes(req.team.id));
});

router.post('/:teamId/content-types', requireTeamRole('admin'), (req, res) => {
  const { name, name_plural, key, schema } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
  const finalName = String(name).trim().slice(0, 60);
  const finalKey = slugify(key || finalName).slice(0, 40);
  if (BUILTIN_TYPES.includes(finalKey)) {
    return res.status(400).json({ error: `"${finalKey}" is a built-in type` });
  }
  const normalized = normalizeSchema(schema);
  if (normalized.error) return res.status(400).json({ error: normalized.error });
  const db = getDb();
  if (db.prepare('SELECT 1 FROM content_types WHERE team_id = ? AND key = ?').get(req.team.id, finalKey)) {
    return res.status(409).json({ error: `A content type with key "${finalKey}" already exists` });
  }
  const result = db
    .prepare('INSERT INTO content_types (team_id, key, name, name_plural, schema) VALUES (?, ?, ?, ?, ?)')
    .run(
      req.team.id,
      finalKey,
      finalName,
      String(name_plural || `${finalName}s`).trim().slice(0, 60),
      JSON.stringify(normalized.schema)
    );
  audit(req.team.id, req.user, 'type.create', finalName, finalKey);
  const row = db.prepare('SELECT * FROM content_types WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ ...row, schema: normalized.schema, kinds: FIELD_KINDS });
});

router.put('/:teamId/content-types/:ctId', requireTeamRole('admin'), (req, res) => {
  const db = getDb();
  const existing = db
    .prepare('SELECT * FROM content_types WHERE id = ? AND team_id = ?')
    .get(req.params.ctId, req.team.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { name, name_plural, schema } = req.body || {};
  let newSchema = existing.schema;
  if (schema !== undefined) {
    const normalized = normalizeSchema(schema);
    if (normalized.error) return res.status(400).json({ error: normalized.error });
    newSchema = JSON.stringify(normalized.schema);
  }
  db.prepare('UPDATE content_types SET name = ?, name_plural = ?, schema = ? WHERE id = ?').run(
    name !== undefined && String(name).trim() ? String(name).trim().slice(0, 60) : existing.name,
    name_plural !== undefined && String(name_plural).trim()
      ? String(name_plural).trim().slice(0, 60)
      : existing.name_plural,
    newSchema,
    existing.id
  );
  audit(req.team.id, req.user, 'type.update', existing.key);
  const row = db.prepare('SELECT * FROM content_types WHERE id = ?').get(existing.id);
  res.json({ ...row, schema: JSON.parse(row.schema) });
});

// Deleting a type requires it to be unused — content of that type would
// otherwise be stranded with an undefined schema.
router.delete('/:teamId/content-types/:ctId', requireTeamRole('admin'), (req, res) => {
  const db = getDb();
  const existing = db
    .prepare('SELECT * FROM content_types WHERE id = ? AND team_id = ?')
    .get(req.params.ctId, req.team.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const used = db
    .prepare('SELECT COUNT(*) AS n FROM content WHERE team_id = ? AND type = ?')
    .get(req.team.id, existing.key).n;
  if (used > 0) {
    return res.status(409).json({ error: `${used} content item(s) use this type — delete or retype them first` });
  }
  db.prepare('DELETE FROM content_types WHERE id = ?').run(existing.id);
  audit(req.team.id, req.user, 'type.delete', existing.key);
  res.json({ ok: true });
});

// ---------- full export (no lock-in) ----------

router.get('/:teamId/export', requireTeamRole('admin'), (req, res) => {
  const db = getDb();
  const settings = Object.fromEntries(
    db.prepare('SELECT key, value FROM team_settings WHERE team_id = ?').all(req.team.id).map((r) => [r.key, r.value])
  );
  const content = db
    .prepare('SELECT * FROM content WHERE team_id = ? AND deleted_at IS NULL ORDER BY id')
    .all(req.team.id)
    .map((row) => {
      const tags = db
        .prepare('SELECT t.name FROM tags t JOIN content_tags ct ON ct.tag_id = t.id WHERE ct.content_id = ?')
        .all(row.id)
        .map((t) => t.name);
      const { published_snapshot, ...rest } = row;
      return { ...rest, fields: parseFieldValues(row.fields), tags };
    });
  const contentTypes = listTypes(req.team.id).map(({ key, name, name_plural, schema }) => ({
    key,
    name,
    name_plural,
    schema,
  }));
  const members = db
    .prepare(
      'SELECT u.username, tm.role, tm.created_at FROM team_members tm JOIN users u ON u.id = tm.user_id WHERE tm.team_id = ?'
    )
    .all(req.team.id);
  const media = db
    .prepare('SELECT filename, original_name, mime_type, size, created_at FROM media WHERE team_id = ?')
    .all(req.team.id);
  res.set('Content-Disposition', `attachment; filename="${req.team.slug}-export.json"`);
  res.json({
    format: 'nova-cms-export',
    version: 1,
    exported_at: new Date().toISOString(),
    company: { name: req.team.name, slug: req.team.slug, custom_domain: req.team.custom_domain },
    settings,
    members,
    media,
    content_types: contentTypes,
    content,
  });
});

// ---------- contact-form inbox ----------

router.get('/:teamId/forms', requireTeamRole('admin'), (req, res) => {
  const rows = getDb()
    .prepare('SELECT * FROM form_submissions WHERE team_id = ? ORDER BY id DESC LIMIT 200')
    .all(req.team.id);
  res.json(rows);
});

router.delete('/:teamId/forms/:formId', requireTeamRole('admin'), (req, res) => {
  const result = getDb()
    .prepare('DELETE FROM form_submissions WHERE id = ? AND team_id = ?')
    .run(req.params.formId, req.team.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// ---------- importers (no lock-in, both directions) ----------

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 50 },
});

// Accepts WordPress WXR exports (.xml), Markdown files with front matter
// (.md), and Nova's own JSON export (.json). Admin-only: published items
// import as published, everything else as drafts.
router.post('/:teamId/import', requireTeamRole('admin'), importUpload.array('files', 50), (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'Upload one or more files in the "files" field' });
  let imported = 0;
  let typesCreated = 0;
  const notes = [];
  const db = getDb();
  db.transaction(() => {
    for (const f of files) {
      const name = f.originalname || 'file';
      const text = f.buffer.toString('utf8');
      try {
        if (/\.xml$/i.test(name) || /<rss[\s>]/.test(text.slice(0, 2000))) {
          const { items, skipped } = parseWxr(text);
          for (const item of items) {
            insertItem(req.team.id, item, req.user);
            imported++;
          }
          if (!items.length) notes.push(`${name}: no posts or pages found`);
          else if (skipped.length) notes.push(`${name}: skipped ${skipped.length} non-content item(s)`);
        } else if (/\.json$/i.test(name)) {
          const data = JSON.parse(text);
          if (data.format !== 'nova-cms-export') {
            notes.push(`${name}: not a Nova export (missing "format": "nova-cms-export")`);
            continue;
          }
          const result = importNovaExport(req.team.id, data, req.user);
          imported += result.imported;
          typesCreated += result.types;
        } else if (/\.(md|markdown|txt)$/i.test(name)) {
          insertItem(req.team.id, parseMarkdown(text, name), req.user);
          imported++;
        } else {
          notes.push(`${name}: unsupported file type (use .xml, .json, or .md)`);
        }
      } catch (err) {
        notes.push(`${name}: ${err.message}`);
      }
    }
  })();
  if (imported) audit(req.team.id, req.user, 'content.import', `${imported} item(s)`, `${files.length} file(s)`);
  res.json({ ok: true, imported, types_created: typesCreated, notes });
});

// ---------- company-scoped resources ----------

router.use('/:teamId/content', requireTeamRole('manager'), contentRoutes);
router.use('/:teamId/tags', requireTeamRole('manager'), tagRoutes);
router.use('/:teamId/media', requireTeamRole('manager'), mediaRoutes);

module.exports = router;
