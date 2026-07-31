const express = require('express');
const { marked } = require('marked');

const { getDb, slugify, uniqueSlug } = require('../db');
const { audit } = require('../audit');
const { deliver, contentPayload } = require('../webhooks');
const { FORMATS, renderBody } = require('../render');
const { isValidType, validateFields, parseFieldValues, expandReferences } = require('../content-types');
const { aiAvailable, reviewContent, translateContent } = require('../ai');
const { rateLimit } = require('../security');
const { notifySubmission, notifyDecision, notifyComment } = require('../notify');
const { overLimit, usageOf } = require('../plans');
const { signShareToken } = require('../auth');

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
       WHERE team_id = ? AND (id = ? OR translation_of = ?) AND deleted_at IS NULL ORDER BY locale`
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

function safeJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function serialize(row, { withHtml = false } = {}) {
  const live = safeJson(row.published_snapshot);
  const { published_snapshot, ...rest } = row;
  const out = {
    ...rest,
    fields: parseFieldValues(row.fields),
    ai_review: safeJson(row.ai_review),
    live_version: live,
    tags: loadTags(row.id),
  };
  if (withHtml) {
    out.references = expandReferences(row.team_id, row.type, out.fields);
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

/** Fire-and-forget AI pre-review of a pending submission. The admin sees
    the result in the approvals queue when it lands; the author's save is
    never blocked on it. Disable with NOVA_AI_REVIEW=0. */
function scheduleAiReview(teamId, contentId) {
  if (!aiAvailable() || process.env.NOVA_AI_REVIEW === '0') return;
  const db = getDb();
  const row = db.prepare('SELECT * FROM content WHERE id = ? AND team_id = ?').get(contentId, teamId);
  if (!row || row.status !== 'pending') return;
  const live = safeJson(row.published_snapshot);
  reviewContent({ title: row.title, body: row.body, excerpt: row.excerpt, format: row.format, live })
    .then((review) => {
      // Only attach if the item is still awaiting review.
      db.prepare("UPDATE content SET ai_review = ? WHERE id = ? AND status = 'pending'").run(
        JSON.stringify({ ...review, at: new Date().toISOString() }),
        row.id
      );
    })
    .catch(() => {}); // a failed review is simply absent
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
  const where = ['c.team_id = ?', 'c.deleted_at IS NULL'];
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

// The trash: soft-deleted items, restorable or purgeable. Declared before
// '/:id' so the literal path wins.
router.get('/trash', (req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT c.*, u.username AS author FROM content c
       LEFT JOIN users u ON u.id = c.author_id
       WHERE c.team_id = ? AND c.deleted_at IS NOT NULL
       ORDER BY c.deleted_at DESC`
    )
    .all(req.team.id);
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
  if (!row || row.deleted_at) return res.status(404).json({ error: 'Not found' });
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
  const planHit = overLimit(req.team, 'content', usageOf(req.team.id).content + 1);
  if (planHit) return res.status(planHit.status).json({ error: planHit.error });

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
  if (row.status === 'pending') {
    scheduleAiReview(req.team.id, row.id);
    notifySubmission(req.team, row, req.user);
  }
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
     locale = ?, fields = ?, ai_review = ?, updated_at = datetime('now') WHERE id = ?`
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
    newStatus === 'pending' ? existing.ai_review : '',
    existing.id
  );
  if (tags !== undefined) setTags(req.team.id, existing.id, tags);
  const updated = db.prepare('SELECT * FROM content WHERE id = ?').get(existing.id);
  saveVersion(updated, req.user.id);
  // A fresh or changed submission gets a fresh AI pre-review.
  if (
    updated.status === 'pending' &&
    (existing.status !== 'pending' || existing.body !== updated.body || existing.title !== updated.title)
  ) {
    scheduleAiReview(req.team.id, updated.id);
  }
  // Entering the queue notifies the company admins (once per submission).
  if (updated.status === 'pending' && existing.status !== 'pending') {
    notifySubmission(req.team, updated, req.user);
  }
  return updated;
}

router.put('/:id', (req, res) => {
  const db = getDb();
  const existing = db
    .prepare('SELECT * FROM content WHERE id = ? AND team_id = ?')
    .get(req.params.id, req.team.id);
  if (!existing || existing.deleted_at) return res.status(404).json({ error: 'Not found' });

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
    `UPDATE content SET status = 'published', review_note = '', published_snapshot = '', ai_review = '',
     published_at = COALESCE(published_at, datetime('now')), updated_at = datetime('now') WHERE id = ?`
  ).run(row.id);
  audit(req.team.id, req.user, 'content.approve', row.title);
  notifyDecision(req.team, row, 'approve', req.user);
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
    "UPDATE content SET status = 'draft', review_note = ?, ai_review = '', updated_at = datetime('now') WHERE id = ?"
  ).run(note, row.id);
  audit(req.team.id, req.user, 'content.reject', row.title, note);
  notifyDecision(req.team, row, 'reject', req.user, note);
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
  const row = db.prepare('SELECT id, title, author_id FROM content WHERE id = ? AND team_id = ?').get(req.params.id, req.team.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const body = String((req.body || {}).body || '').trim().slice(0, 2000);
  if (!body) return res.status(400).json({ error: 'body is required' });
  notifyComment(req.team, row, req.user); // participants so far, before this comment lands
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

// First DELETE moves an item to the trash (off the site, restorable).
// A DELETE on an already-trashed item purges it permanently — admin only.
router.delete('/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM content WHERE id = ? AND team_id = ?').get(req.params.id, req.team.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.deleted_at) {
    if (req.teamRole !== 'admin') {
      return res.status(403).json({ error: 'Deleting from the trash permanently requires a company admin' });
    }
    db.prepare('DELETE FROM content WHERE id = ?').run(row.id);
    audit(req.team.id, req.user, 'content.purge', row.title);
    return res.json({ ok: true, purged: true });
  }
  const wasLive = row.status === 'published' || Boolean(row.published_snapshot);
  db.prepare("UPDATE content SET deleted_at = datetime('now') WHERE id = ?").run(row.id);
  audit(req.team.id, req.user, 'content.trash', row.title);
  if (wasLive) deliver(req.team.id, 'content.deleted', contentPayload(req.team, row));
  res.json({ ok: true, trashed: true });
});

// Restore from the trash — the item returns exactly as it left.
router.post('/:id/untrash', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM content WHERE id = ? AND team_id = ?').get(req.params.id, req.team.id);
  if (!row || !row.deleted_at) return res.status(404).json({ error: 'Not in the trash' });
  db.prepare("UPDATE content SET deleted_at = NULL, updated_at = datetime('now') WHERE id = ?").run(row.id);
  audit(req.team.id, req.user, 'content.untrash', row.title);
  const fresh = db.prepare('SELECT * FROM content WHERE id = ?').get(row.id);
  if (fresh.status === 'published' || fresh.published_snapshot) {
    deliver(req.team.id, 'content.published', contentPayload(req.team, fresh));
  }
  res.json(serialize(fresh));
});

// AI translation: create a translated draft linked into the item's
// translation group. Drafts only — translations go through the same
// approval workflow as everything else.
const aiTranslateLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, name: 'AI translations' });
router.post('/:id/ai-translate', aiTranslateLimiter, async (req, res, next) => {
  try {
    const db = getDb();
    const source = db.prepare('SELECT * FROM content WHERE id = ? AND team_id = ?').get(req.params.id, req.team.id);
    if (!source || source.deleted_at) return res.status(404).json({ error: 'Not found' });
    if (!aiAvailable()) {
      return res.status(503).json({ error: 'AI translation is not configured — set ANTHROPIC_API_KEY on the server' });
    }
    const aiHit = overLimit(req.team, 'ai', 1) || overLimit(req.team, 'content', usageOf(req.team.id).content + 1);
    if (aiHit) return res.status(aiHit.status).json({ error: aiHit.error });
    const target = String((req.body || {}).locale || '').toLowerCase().trim();
    if (!LOCALE_RE.test(target)) {
      return res.status(400).json({ error: 'locale must look like "en", "pt-br", or "zh-hans"' });
    }
    if (target === source.locale) return res.status(400).json({ error: 'That is already the source language' });
    const rootId = groupRoot(source);
    const members = groupMembers(req.team.id, rootId);
    const rootLocale = db.prepare('SELECT locale FROM content WHERE id = ?').get(rootId).locale;
    if (members.some((m) => m.locale === target) || target === rootLocale) {
      return res.status(409).json({ error: `A "${target}" version already exists in this translation group` });
    }

    let translated;
    try {
      translated = await translateContent(source, target);
    } catch (err) {
      return res.status(502).json({ error: `AI translation failed: ${err.message}` });
    }

    const finalSlug = uniqueSlug(translated.title, req.team.id);
    const result = db
      .prepare(
        `INSERT INTO content (team_id, type, title, slug, body, format, excerpt, cover_image, status, author_id, locale, translation_of, fields)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`
      )
      .run(
        req.team.id, source.type, translated.title, finalSlug, translated.body, source.format,
        translated.excerpt, source.cover_image, req.user.id, target, rootId, source.fields
      );
    const row = db.prepare('SELECT * FROM content WHERE id = ?').get(result.lastInsertRowid);
    saveVersion(row, req.user.id);
    audit(req.team.id, req.user, 'content.ai_translate', source.title, `${source.locale} → ${target}`);
    res.status(201).json(serialize(row));
  } catch (err) {
    next(err);
  }
});

// Shareable preview link: a signed, expiring URL that shows this item's
// latest saved version to anyone who has it — no account needed. For
// sending drafts to clients and stakeholders outside Nova.
router.post('/:id/share-link', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM content WHERE id = ? AND team_id = ?').get(req.params.id, req.team.id);
  if (!row || row.deleted_at) return res.status(404).json({ error: 'Not found' });
  const days = Math.min(30, Math.max(1, Number((req.body || {}).days) || 14));
  const token = signShareToken(row.id, days);
  audit(req.team.id, req.user, 'content.share_link', row.title, `${days} days`);
  res.status(201).json({
    url: `/share/${token}`,
    expires_at: new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString(),
  });
});

// Duplicate an item as a fresh draft (fields, tags, and body included).
router.post('/:id/duplicate', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM content WHERE id = ? AND team_id = ?').get(req.params.id, req.team.id);
  if (!row || row.deleted_at) return res.status(404).json({ error: 'Not found' });
  const planHit = overLimit(req.team, 'content', usageOf(req.team.id).content + 1);
  if (planHit) return res.status(planHit.status).json({ error: planHit.error });
  const title = `Copy of ${row.title}`.slice(0, 200);
  const slug = uniqueSlug(title, req.team.id);
  const result = db
    .prepare(
      `INSERT INTO content (team_id, type, title, slug, body, format, excerpt, cover_image, status, author_id, locale, fields)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`
    )
    .run(req.team.id, row.type, title, slug, row.body, row.format, row.excerpt, row.cover_image, req.user.id, row.locale, row.fields);
  db.prepare(
    'INSERT INTO content_tags (content_id, tag_id) SELECT ?, tag_id FROM content_tags WHERE content_id = ?'
  ).run(result.lastInsertRowid, row.id);
  const copy = db.prepare('SELECT * FROM content WHERE id = ?').get(result.lastInsertRowid);
  saveVersion(copy, req.user.id);
  audit(req.team.id, req.user, 'content.duplicate', row.title);
  res.status(201).json(serialize(copy));
});

module.exports = router;
