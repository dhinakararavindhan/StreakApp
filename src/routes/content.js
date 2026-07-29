const express = require('express');

const { getDb, slugify, uniqueSlug } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

function loadTags(contentId) {
  return getDb()
    .prepare(
      `SELECT t.id, t.name, t.slug FROM tags t
       JOIN content_tags ct ON ct.tag_id = t.id
       WHERE ct.content_id = ? ORDER BY t.name`
    )
    .all(contentId);
}

function setTags(contentId, tagNames) {
  const db = getDb();
  db.prepare('DELETE FROM content_tags WHERE content_id = ?').run(contentId);
  for (const raw of tagNames || []) {
    const name = String(raw).trim();
    if (!name) continue;
    const slug = slugify(name);
    db.prepare('INSERT OR IGNORE INTO tags (name, slug) VALUES (?, ?)').run(name, slug);
    const tag = db.prepare('SELECT id FROM tags WHERE slug = ?').get(slug);
    db.prepare('INSERT OR IGNORE INTO content_tags (content_id, tag_id) VALUES (?, ?)').run(
      contentId,
      tag.id
    );
  }
}

function serialize(row) {
  return { ...row, tags: loadTags(row.id) };
}

// List with optional filters: ?type=post&status=published&tag=news&search=hello
router.get('/', requireAuth, (req, res) => {
  const { type, status, tag, search } = req.query;
  const where = [];
  const params = [];
  if (type) { where.push('c.type = ?'); params.push(type); }
  if (status) { where.push('c.status = ?'); params.push(status); }
  if (search) { where.push('(c.title LIKE ? OR c.body LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
  if (tag) {
    where.push(
      'c.id IN (SELECT ct.content_id FROM content_tags ct JOIN tags t ON t.id = ct.tag_id WHERE t.slug = ?)'
    );
    params.push(tag);
  }
  const rows = getDb()
    .prepare(
      `SELECT c.*, u.username AS author FROM content c
       LEFT JOIN users u ON u.id = c.author_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY c.updated_at DESC`
    )
    .all(...params);
  res.json(rows.map(serialize));
});

router.get('/:id', requireAuth, (req, res) => {
  const row = getDb().prepare('SELECT * FROM content WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(serialize(row));
});

router.post('/', requireAuth, (req, res) => {
  const { type = 'post', title, slug, body = '', excerpt = '', status = 'draft', tags } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title is required' });
  if (!['post', 'page'].includes(type)) return res.status(400).json({ error: 'type must be post or page' });
  if (!['draft', 'published'].includes(status)) return res.status(400).json({ error: 'status must be draft or published' });

  const db = getDb();
  const finalSlug = uniqueSlug(slug || title);
  const result = db
    .prepare(
      `INSERT INTO content (type, title, slug, body, excerpt, status, author_id, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'published' THEN datetime('now') ELSE NULL END)`
    )
    .run(type, title, finalSlug, body, excerpt, status, req.user.id, status);
  setTags(result.lastInsertRowid, tags);
  const row = db.prepare('SELECT * FROM content WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(serialize(row));
});

router.put('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM content WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const { title, slug, body, excerpt, status, tags } = req.body || {};
  if (status && !['draft', 'published'].includes(status)) {
    return res.status(400).json({ error: 'status must be draft or published' });
  }
  const newTitle = title !== undefined ? title : existing.title;
  const newSlug = slug !== undefined || title !== undefined
    ? uniqueSlug(slug || newTitle, existing.id)
    : existing.slug;
  const newStatus = status !== undefined ? status : existing.status;
  const publishedAt =
    newStatus === 'published'
      ? existing.published_at || new Date().toISOString().replace('T', ' ').slice(0, 19)
      : null;

  db.prepare(
    `UPDATE content SET title = ?, slug = ?, body = ?, excerpt = ?, status = ?,
     published_at = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(
    newTitle,
    newSlug,
    body !== undefined ? body : existing.body,
    excerpt !== undefined ? excerpt : existing.excerpt,
    newStatus,
    publishedAt,
    existing.id
  );
  if (tags !== undefined) setTags(existing.id, tags);
  res.json(serialize(db.prepare('SELECT * FROM content WHERE id = ?').get(existing.id)));
});

router.delete('/:id', requireAuth, (req, res) => {
  const result = getDb().prepare('DELETE FROM content WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

module.exports = router;
