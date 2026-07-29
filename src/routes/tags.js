const express = require('express');

const { getDb } = require('../db');

// Mounted at /api/teams/:teamId/tags behind requireTeamRole('editor').
const router = express.Router({ mergeParams: true });

router.get('/', (req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT t.*, COUNT(ct.content_id) AS content_count FROM tags t
       LEFT JOIN content_tags ct ON ct.tag_id = t.id
       WHERE t.team_id = ?
       GROUP BY t.id ORDER BY t.name`
    )
    .all(req.team.id);
  res.json(rows);
});

router.delete('/:id', (req, res) => {
  const result = getDb()
    .prepare('DELETE FROM tags WHERE id = ? AND team_id = ?')
    .run(req.params.id, req.team.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

module.exports = router;
