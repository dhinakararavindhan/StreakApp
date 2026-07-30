const express = require('express');

const { getDb, slugify, uniqueSlug } = require('../db');

// Mounted at /api/teams/:teamId/content behind requireTeamRole('manager'),
// which sets req.team and req.teamRole — every query below is scoped to
// that company.
//
// Approval workflow: managers can create, edit, and delete content, but
// nothing they touch goes live directly. They may hold work as 'draft' or
// submit it as 'pending'; only company admins (and superadmins) can move
// content to 'published' — via approve or by editing as an admin.
const router = express.Router({ mergeParams: true });

const STATUSES = ['draft', 'pending', 'published'];

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

function serialize(row) {
  return { ...row, tags: loadTags(row.id) };
}

// List with optional filters: ?type=post&status=pending&tag=news&search=hello
router.get('/', (req, res) => {
  const { type, status, tag, search } = req.query;
  const where = ['c.team_id = ?'];
  const params = [req.team.id];
  if (type) { where.push('c.type = ?'); params.push(type); }
  if (status) { where.push('c.status = ?'); params.push(status); }
  if (search) { where.push('(c.title LIKE ? OR c.body LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
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
  res.json(rows.map(serialize));
});

router.get('/:id', (req, res) => {
  const row = getDb()
    .prepare('SELECT * FROM content WHERE id = ? AND team_id = ?')
    .get(req.params.id, req.team.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(serialize(row));
});

router.post('/', (req, res) => {
  const { type = 'post', title, slug, body = '', excerpt = '', cover_image = '', status = 'draft', tags } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title is required' });
  if (!['post', 'page'].includes(type)) return res.status(400).json({ error: 'type must be post or page' });
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'status must be draft, pending, or published' });
  if (status === 'published' && req.teamRole !== 'admin') {
    return res.status(403).json({ error: 'Publishing requires admin approval — submit for review (status "pending") instead' });
  }

  const db = getDb();
  const finalSlug = uniqueSlug(slug || title, req.team.id);
  const result = db
    .prepare(
      `INSERT INTO content (team_id, type, title, slug, body, excerpt, cover_image, status, author_id, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'published' THEN datetime('now') ELSE NULL END)`
    )
    .run(req.team.id, type, title, finalSlug, body, excerpt, String(cover_image), status, req.user.id, status);
  setTags(req.team.id, result.lastInsertRowid, tags);
  const row = db.prepare('SELECT * FROM content WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(serialize(row));
});

router.put('/:id', (req, res) => {
  const db = getDb();
  const existing = db
    .prepare('SELECT * FROM content WHERE id = ? AND team_id = ?')
    .get(req.params.id, req.team.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const { title, slug, body, excerpt, cover_image, status, tags } = req.body || {};
  if (status && !STATUSES.includes(status)) {
    return res.status(400).json({ error: 'status must be draft, pending, or published' });
  }
  if (status === 'published' && req.teamRole !== 'admin' && existing.status !== 'published') {
    return res.status(403).json({ error: 'Publishing requires admin approval — submit for review (status "pending") instead' });
  }

  let newStatus = status !== undefined ? status : existing.status;
  // A manager editing live content pulls it back into review — nothing a
  // manager writes reaches the site without an admin's approval.
  if (req.teamRole !== 'admin' && newStatus === 'published') {
    newStatus = 'pending';
  }

  const newTitle = title !== undefined ? title : existing.title;
  const newSlug = slug !== undefined || title !== undefined
    ? uniqueSlug(slug || newTitle, req.team.id, existing.id)
    : existing.slug;
  const publishedAt =
    newStatus === 'published'
      ? existing.published_at || new Date().toISOString().replace('T', ' ').slice(0, 19)
      : null;
  // Leaving draft clears any stale rejection note.
  const reviewNote = newStatus === 'draft' ? existing.review_note : '';

  db.prepare(
    `UPDATE content SET title = ?, slug = ?, body = ?, excerpt = ?, cover_image = ?, status = ?,
     review_note = ?, published_at = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(
    newTitle,
    newSlug,
    body !== undefined ? body : existing.body,
    excerpt !== undefined ? excerpt : existing.excerpt,
    cover_image !== undefined ? String(cover_image) : existing.cover_image,
    newStatus,
    reviewNote,
    publishedAt,
    existing.id
  );
  if (tags !== undefined) setTags(req.team.id, existing.id, tags);
  res.json(serialize(db.prepare('SELECT * FROM content WHERE id = ?').get(existing.id)));
});

// Approve a pending item (company admins only) — it goes live.
router.post('/:id/approve', (req, res) => {
  if (req.teamRole !== 'admin') return res.status(403).json({ error: 'Company admin access required' });
  const db = getDb();
  const row = db.prepare('SELECT * FROM content WHERE id = ? AND team_id = ?').get(req.params.id, req.team.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.status !== 'pending') return res.status(400).json({ error: 'Only pending content can be approved' });
  db.prepare(
    `UPDATE content SET status = 'published', review_note = '',
     published_at = COALESCE(published_at, datetime('now')), updated_at = datetime('now') WHERE id = ?`
  ).run(row.id);
  res.json(serialize(db.prepare('SELECT * FROM content WHERE id = ?').get(row.id)));
});

// Reject a pending item back to draft, optionally with a note for the author.
router.post('/:id/reject', (req, res) => {
  if (req.teamRole !== 'admin') return res.status(403).json({ error: 'Company admin access required' });
  const db = getDb();
  const row = db.prepare('SELECT * FROM content WHERE id = ? AND team_id = ?').get(req.params.id, req.team.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.status !== 'pending') return res.status(400).json({ error: 'Only pending content can be rejected' });
  const note = String((req.body || {}).note || '').slice(0, 500);
  db.prepare(
    "UPDATE content SET status = 'draft', review_note = ?, published_at = NULL, updated_at = datetime('now') WHERE id = ?"
  ).run(note, row.id);
  res.json(serialize(db.prepare('SELECT * FROM content WHERE id = ?').get(row.id)));
});

router.delete('/:id', (req, res) => {
  const result = getDb()
    .prepare('DELETE FROM content WHERE id = ? AND team_id = ?')
    .run(req.params.id, req.team.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

module.exports = router;
