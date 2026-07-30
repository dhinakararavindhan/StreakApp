const express = require('express');
const { marked } = require('marked');

const { getDb, slugify, uniqueSlug } = require('../db');
const { audit } = require('../audit');
const { deliver, contentPayload } = require('../webhooks');
const { FORMATS, renderBody } = require('../render');
const { isValidType, validateFields, parseFieldValues } = require('../content-types');

// Mounted at /api/teams/:teamId/content behind requireTeamRole('manager'),
// which sets req.team and req.teamRole — every query below is scoped to
// that company.
//
// Approval workflow: managers can create, edit, and delete content, but
// nothing they touch goes live directly. They may hold work as 'draft' or
// submit it as 'pending'; only company admins (and superadmins) can move
// content to 'published'. While edits are in review, the previously
// approved version stays live via published_snapshot.
const router = express.Router({ mergeParams: true });

const STATUSES = ['draft', 'pending', 'published'];
const MAX_VERSIONS = 50;
const LOCALE_RE = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/;

function teamDefaultLocale(teamId) {
  const row = getDb()
    .prepare("SELECT value FROM team_settings WHERE team_id = ? AND key = 'default_locale'")
    .get(teamId);
  return (row && row.value) || 'en';
}

/** The translation group root id for a row. */
function groupRoot(row) {
  return row.translation_of || row.id;
}

function groupMembers(teamId, rootId) {
  return getDb()
    .prepare(
      `SELECT id, locale, title, slug, status FROM content
       WHERE team_id = ? AND (id = ? OR translation_of = ?) ORDER BY locale`
    )
    .all(teamId, rootId, rootId);
}

function loadTags(contentId) {
  return getDb()
    .prepare(
      `SELECT t.id, t.name, t.slug FROM tags t
       JOIN content_tags ct ON ct.tag_id = t.id
       WHERE ct.content_id = ? ORDER BY t.name`
    )
    .all(contentId);
}

function setTags(teamId, contentId, tagNames) {
  const db = getDb();
  db.prepare('DELETE FROM content_tags WHERE content_id = ?').run(contentId);
  for (const raw of tagNames || []) {
    const name = String(raw).trim();
    if (!name) continue;
    const slug = slugify(name);
    db.prepare('INSERT OR IGNORE INTO tags (team_id, name, slug) VALUES (?, ?, ?)').run(teamId, name, slug);
    const tag = db.prepare('SELECT id FROM tags WHERE team_id = ? AND slug = ?').get(teamId, slug);
    db.prepare('INSERT OR IGNORE INTO content_tags (content_id, tag_id) VALUES (?, ?)').run(contentId, tag.id);
  }
}

function serialize(row, { withHtml = false } = {}) {
  let live = null;
  if (row.published_snapshot) {
    try {
      live = JSON.parse(row.published_snapshot);
    } catch {
      live = null;
    }
  }
  const { published_snapshot, ...rest } = row;
  const out = { ...rest, fields: parseFieldValues(row.fields), live_version: live, tags: loadTags(row.id) };
  if (withHtml) {
    out.body_html = renderBody(row.format, row.body, row.excerpt);
    out.translations = groupMembers(row.team_id, groupRoot(row)).filter((t) => t.id !== row.id);
    const lastEditor = getDb()
      .prepare(
        `SELECT u.username FROM content_versions v LEFT JOIN users u ON u.id = v.edited_by
         WHERE v.content_id = ? ORDER BY v.id DESC LIMIT 1`
      )
      .get(row.id);
    out.last_edited_by = lastEditor ? lastEditor.username : null;
  }
  return out;
}

/** Record the current state of a row as a version. */
function saveVersion(row, userId) {
  const db = getDb();
  db.prepare(
    `INSERT INTO content_versions (content_id, team_id, title, body, format, excerpt, cover_image, status, fields, edited_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(row.id, row.team_id, row.title, row.body, row.format, row.excerpt, row.cover_image, row.status, row.fields || '{}', userId);
  db.prepare(
    `DELETE FROM content_versions WHERE content_id = ? AND id NOT IN
     (SELECT id FROM content_versions WHERE content_id = ? ORDER BY id DESC LIMIT ?)`
  ).run(row.id, row.id, MAX_VERSIONS);
}

/** Normalize a schedule datetime. Returns null (clear), a normalized
    'YYYY-MM-DD HH:MM:SS' string, or undefined for invalid input. */
function normalizeWhen(value) {
  if (value === null || value === '' ) return null;
  const s = String(value).trim().replace('T', ' ');
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) return `${s}:00`;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return s;
  return undefined;
}

// List with optional filters: ?type=post&status=pending&tag=news&search=hello
router.get('/', (req, res) => {
  const { type, status, tag, search, locale } = req.query;
  const where = ['c.team_id = ?'];
  const params = [req.team.id];
  if (type) { where.push('c.type = ?'); params.push(type); }
  if (status) { where.push('c.status = ?'); params.push(status); }
  if (search) { where.push('(c.title LIKE ? OR c.body LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
  if (locale) { where.push('c.locale = ?'); params.push(String(locale).toLowerCase()); }
  if (tag) {
    where.push(
      'c.id IN (SELECT ct.content_id FROM content_tags ct JOIN tags t ON t.id = ct.tag_id WHERE t.team_id = ? AND t.slug = ?)'
    );
    params.push(req.team.id, tag);
  }
  const rows = getDb()
    .prepare(
      `SELECT c.*, u.username AS author FROM content c
       LEFT JOIN users u ON u.id = c.author_id
       WHERE ${where.join(' AND ')}
       ORDER BY c.updated_at DESC`
    )
    .all(...params);
  res.json(rows.map((r) => serialize(r)));
});

router.get('/:id', (req, res) => {
  const row = getDb()
    .prepare(
      `SELECT c.*, u.username AS author FROM content c
       LEFT JOIN users u ON u.id = c.author_id
       WHERE c.id = ? AND c.team_id = ?`
    )
    .get(req.params.id, req.team.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(serialize(row, { withHtml: true }));
});

router.post('/', (req, res) => {
  const {
    type = 'post', title, slug, body = '', format = 'markdown', excerpt = '', cover_image = '',
    status = 'draft', tags, publish_at, expire_at, locale, translation_of, fields,
  } = req.body || {};
  if (!FORMATS.includes(format)) {
    return res.status(400).json({ error: `format must be one of: ${FORMATS.join(', ')}` });
  }
  if (!title) return res.status(400).json({ error: 'title is required' });
  if (!isValidType(req.team.id, type)) {
    return res.status(400).json({ error: `Unknown content type "${type}" — use post, page, or a defined custom type` });
  }
  const fieldCheck = validateFields(req.team.id, type, fields === undefined ? {} : fields);
  if (fieldCheck.error) return res.status(400).json({ error: fieldCheck.error });
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'status must be draft, pending, or published' });
  if (status === 'published' && req.teamRole !== 'admin') {
    return res.status(403).json({ error: 'Publishing requires admin approval — submit for review (status "pending") instead' });
  }
  const publishAt = normalizeWhen(publish_at === undefined ? null : publish_at);
  const expireAt = normalizeWhen(expire_at === undefined ? null : expire_at);
  if (publishAt === undefined || expireAt === undefined) {
    return res.status(400).json({ error: 'publish_at/expire_at must be YYYY-MM-DD HH:MM (UTC) or empty' });
  }

  const db = getDb();
  const finalLocale = String(locale || teamDefaultLocale(req.team.id)).toLowerCase();
  if (!LOCALE_RE.test(finalLocale)) {
    return res.status(400).json({ error: 'locale must look like "en", "pt-br", or "zh-hans"' });
  }
  let rootId = null;
  if (translation_of !== undefined && translation_of !== null && translation_of !== '') {
    const target = db
      .prepare('SELECT * FROM content WHERE id = ? AND team_id = ?')
      .get(translation_of, req.team.id);
    if (!target) return res.status(404).json({ error: 'translation_of item not found' });
    rootId = groupRoot(target);
    const clash = groupMembers(req.team.id, rootId).some((m) => m.locale === finalLocale);
    if (clash || finalLocale === db.prepare('SELECT locale FROM content WHERE id = ?').get(rootId).locale) {
      return res.status(409).json({ error: `A "${finalLocale}" version already exists in this translation group` });
    }
  }

  const finalSlug = uniqueSlug(slug || title, req.team.id);
  const result = db
    .prepare(
      `INSERT INTO content (team_id, type, title, slug, body, format, excerpt, cover_image, status, author_id, publish_at, expire_at, locale, translation_of, fields, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'published' THEN datetime('now') ELSE NULL END)`
    )
    .run(req.team.id, type, title, finalSlug, body, format, excerpt, String(cover_image), status, req.user.id, publishAt, expireAt, finalLocale, rootId, JSON.stringify(fieldCheck.values || {}), status);
  setTags(req.team.id, result.lastInsertRowid, tags);
  const row = db.prepare('SELECT * FROM content WHERE id = ?').get(result.lastInsertRowid);
  saveVersion(row, req.user.id);
  audit(req.team.id, req.user, status === 'pending' ? 'content.submit' : 'content.create', title);
  if (row.status === 'published') deliver(req.team.id, 'content.published', contentPayload(req.team, row));
  res.status(201).json(serialize(row));
});

/** Core update used by PUT and version-restore. `fields` may hold title,
    slug, body, excerpt, cover_image, status, tags, publish_at, expire_at. */
function applyUpdate(req, res, existing, fields) {
  const db = getDb();
  const { title, slug, body, format, excerpt, cover_image, status, tags, publish_at, expire_at, locale, fields: fieldValues } = fields;
  if (format !== undefined && !FORMATS.includes(format)) {
    return res.status(400).json({ error: `format must be one of: ${FORMATS.join(', ')}` });
  }
  const fieldCheck = validateFields(req.team.id, existing.type, fieldValues);
  if (fieldCheck.error) {
    res.status(400).json({ error: fieldCheck.error });
    return undefined;
  }
  let newLocale = existing.locale;
  if (locale !== undefined) {
    newLocale = String(locale).toLowerCase();
    if (!LOCALE_RE.test(newLocale)) {
      return res.status(400).json({ error: 'locale must look like "en", "pt-br", or "zh-hans"' });
    }
  }
  if (status && !STATUSES.includes(status)) {
    return res.status(400).json({ error: 'status must be draft, pending, or published' });
  }
  if (status === 'published' && req.teamRole !== 'admin' && existing.status !== 'published') {
    return res.status(403).json({ error: 'Publishing requires admin approval — submit for review (status "pending") instead' });
  }
  const publishAt = publish_at === undefined ? existing.publish_at : normalizeWhen(publish_at);
  const expireAt = expire_at === undefined ? existing.expire_at : normalizeWhen(expire_at);
  if (publishAt === undefined || expireAt === undefined) {
    return res.status(400).json({ error: 'publish_at/expire_at must be YYYY-MM-DD HH:MM (UTC) or empty' });
  }

  let newStatus = status !== undefined ? status : existing.status;
  // A manager editing live content pulls it back into review — nothing a
  // manager writes reaches the site without an admin's approval.
  if (req.teamRole !== 'admin' && newStatus === 'published') {
    newStatus = 'pending';
  }

  // The previously approved version stays live (as a snapshot) while the
  // new edits await review. An admin explicitly setting draft is a true
  // unpublish and drops the snapshot.
  let snapshot = existing.published_snapshot;
  if (existing.status === 'published' && newStatus !== 'published' && !snapshot) {
    snapshot = JSON.stringify({
      title: existing.title,
      slug: existing.slug,
      body: existing.body,
      format: existing.format,
      excerpt: existing.excerpt,
      cover_image: existing.cover_image,
      fields: existing.fields,
      published_at: existing.published_at,
    });
  }
  if (newStatus === 'published') snapshot = '';
  if (newStatus === 'draft' && req.teamRole === 'admin' && status !== undefined) snapshot = '';

  const newTitle = title !== undefined ? title : existing.title;
  // While a live snapshot exists, the public URL must not drift — freeze the slug.
  const newSlug = snapshot
    ? existing.slug
    : slug !== undefined || title !== undefined
      ? uniqueSlug(slug || newTitle, req.team.id, existing.id)
      : existing.slug;
  const publishedAt =
    newStatus === 'published'
      ? existing.published_at || new Date().toISOString().replace('T', ' ').slice(0, 19)
      : snapshot
        ? existing.published_at
        : null;
  // Leaving draft clears any stale rejection note.
  const reviewNote = newStatus === 'draft' ? existing.review_note : '';

  db.prepare(
    `UPDATE content SET title = ?, slug = ?, body = ?, format = ?, excerpt = ?, cover_image = ?, status = ?,
     review_note = ?, published_snapshot = ?, publish_at = ?, expire_at = ?, published_at = ?,
     locale = ?, fields = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(
    newTitle,
    newSlug,
    body !== undefined ? body : existing.body,
    format !== undefined ? format : existing.format,
    excerpt !== undefined ? excerpt : existing.excerpt,
    cover_image !== undefined ? String(cover_image) : existing.cover_image,
    newStatus,
    reviewNote,
    snapshot,
    publishAt,
    expireAt,
    publishedAt,
    newLocale,
    fieldCheck.values !== undefined ? JSON.stringify(fieldCheck.values) : existing.fields,
    existing.id
  );
  if (tags !== undefined) setTags(req.team.id, existing.id, tags);
  const updated = db.prepare('SELECT * FROM content WHERE id = ?').get(existing.id);
  saveVersion(updated, req.user.id);
  return updated;
}

router.put('/:id', (req, res) => {
  const db = getDb();
  const existing = db
    .prepare('SELECT * FROM content WHERE id = ? AND team_id = ?')
    .get(req.params.id, req.team.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const updated = applyUpdate(req, res, existing, req.body || {});
  if (!updated) return; // applyUpdate already responded with an error
  const action =
    updated.status === 'pending' && existing.status !== 'pending'
      ? 'content.submit'
      : updated.status === 'published' && existing.status !== 'published'
        ? 'content.publish'
        : 'content.update';
  audit(req.team.id, req.user, action, updated.title);
  if (updated.status === 'published') {
    deliver(
      req.team.id,
      existing.status === 'published' || existing.published_snapshot ? 'content.updated' : 'content.published',
      contentPayload(req.team, updated)
    );
  } else if (existing.status === 'published' && !updated.published_snapshot) {
    deliver(req.team.id, 'content.unpublished', contentPayload(req.team, updated));
  }
  res.json(serialize(updated));
});

// ---------- version history ----------

router.get('/:id/versions', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT id FROM content WHERE id = ? AND team_id = ?').get(req.params.id, req.team.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const versions = db
    .prepare(
      `SELECT v.id, v.title, v.body, v.format, v.excerpt, v.cover_image, v.status, v.fields, v.created_at,
              u.username AS edited_by
       FROM content_versions v LEFT JOIN users u ON u.id = v.edited_by
       WHERE v.content_id = ? ORDER BY v.id DESC`
    )
    .all(row.id);
  res.json(versions.map((v) => ({ ...v, fields: parseFieldValues(v.fields) })));
});

router.post('/:id/versions/:versionId/restore', (req, res) => {
  const db = getDb();
  const existing = db
    .prepare('SELECT * FROM content WHERE id = ? AND team_id = ?')
    .get(req.params.id, req.team.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const version = db
    .prepare('SELECT * FROM content_versions WHERE id = ? AND content_id = ?')
    .get(req.params.versionId, existing.id);
  if (!version) return res.status(404).json({ error: 'Version not found' });

  // Restoring applies the old fields as a fresh edit — all workflow rules
  // (manager pull-back, snapshots, slug freeze) apply as usual.
  const updated = applyUpdate(req, res, existing, {
    title: version.title,
    body: version.body,
    format: version.format,
    excerpt: version.excerpt,
    cover_image: version.cover_image,
    fields: parseFieldValues(version.fields),
  });
  if (!updated) return;
  audit(req.team.id, req.user, 'content.restore', updated.title, `version ${version.id}`);
  res.json(serialize(updated));
});

// ---------- review actions ----------

// Approve a pending item (company admins only) — it goes live.
router.post('/:id/approve', (req, res) => {
  if (req.teamRole !== 'admin') return res.status(403).json({ error: 'Company admin access required' });
  const db = getDb();
  const row = db.prepare('SELECT * FROM content WHERE id = ? AND team_id = ?').get(req.params.id, req.team.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.status !== 'pending') return res.status(400).json({ error: 'Only pending content can be approved' });
  const hadLiveSnapshot = Boolean(row.published_snapshot);
  db.prepare(
    `UPDATE content SET status = 'published', review_note = '', published_snapshot = '',
     published_at = COALESCE(published_at, datetime('now')), updated_at = datetime('now') WHERE id = ?`
  ).run(row.id);
  audit(req.team.id, req.user, 'content.approve', row.title);
  const fresh = db.prepare('SELECT * FROM content WHERE id = ?').get(row.id);
  deliver(req.team.id, hadLiveSnapshot ? 'content.updated' : 'content.published', contentPayload(req.team, fresh));
  res.json(serialize(fresh));
});

// Reject a pending item back to draft, optionally with a note for the author.
router.post('/:id/reject', (req, res) => {
  if (req.teamRole !== 'admin') return res.status(403).json({ error: 'Company admin access required' });
  const db = getDb();
  const row = db.prepare('SELECT * FROM content WHERE id = ? AND team_id = ?').get(req.params.id, req.team.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.status !== 'pending') return res.status(400).json({ error: 'Only pending content can be rejected' });
  const note = String((req.body || {}).note || '').slice(0, 500);
  // The live snapshot (if any) stays up — rejection only bounces the edits.
  db.prepare(
    "UPDATE content SET status = 'draft', review_note = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(note, row.id);
  audit(req.team.id, req.user, 'content.reject', row.title, note);
  res.json(serialize(db.prepare('SELECT * FROM content WHERE id = ?').get(row.id)));
});

// ---------- comments (reviewer ↔ author threads) ----------

router.get('/:id/comments', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT id FROM content WHERE id = ? AND team_id = ?').get(req.params.id, req.team.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const rows = db
    .prepare(
      `SELECT c.id, c.body, c.created_at, u.username AS author
       FROM content_comments c LEFT JOIN users u ON u.id = c.user_id
       WHERE c.content_id = ? ORDER BY c.id`
    )
    .all(row.id);
  res.json(rows);
});

router.post('/:id/comments', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT id, title FROM content WHERE id = ? AND team_id = ?').get(req.params.id, req.team.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const body = String((req.body || {}).body || '').trim().slice(0, 2000);
  if (!body) return res.status(400).json({ error: 'body is required' });
  const result = db
    .prepare('INSERT INTO content_comments (content_id, user_id, body) VALUES (?, ?, ?)')
    .run(row.id, req.user.id, body);
  const comment = db
    .prepare(
      `SELECT c.id, c.body, c.created_at, u.username AS author
       FROM content_comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = ?`
    )
    .get(result.lastInsertRowid);
  res.status(201).json(comment);
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM content WHERE id = ? AND team_id = ?').get(req.params.id, req.team.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const wasLive = row.status === 'published' || Boolean(row.published_snapshot);
  db.prepare('DELETE FROM content WHERE id = ? AND team_id = ?').run(req.params.id, req.team.id);
  audit(req.team.id, req.user, 'content.delete', row.title);
  if (wasLive) deliver(req.team.id, 'content.deleted', contentPayload(req.team, row));
  res.json({ ok: true });
});

module.exports = router;
