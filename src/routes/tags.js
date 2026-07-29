const express = require('express');

const { getDb } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT t.*, COUNT(ct.content_id) AS content_count FROM tags t
       LEFT JOIN content_tags ct ON ct.tag_id = t.id
       GROUP BY t.id ORDER BY t.name`
    )
    .all();
  res.json(rows);
});

router.delete('/:id', requireAuth, (req, res) => {
  const result = getDb().prepare('DELETE FROM tags WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

module.exports = router;
