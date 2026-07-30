const express = require('express');

const { getDb } = require('../db');
const { requireSuperadmin } = require('../auth');

// Superadmin-only platform overview.
const router = express.Router();

router.get('/stats', requireSuperadmin, (req, res) => {
  const db = getDb();
  const one = (sql) => db.prepare(sql).get().n;
  res.json({
    companies: one('SELECT COUNT(*) AS n FROM teams'),
    users: one('SELECT COUNT(*) AS n FROM users'),
    content: one('SELECT COUNT(*) AS n FROM content'),
    published: one("SELECT COUNT(*) AS n FROM content WHERE status = 'published'"),
    media: one('SELECT COUNT(*) AS n FROM media'),
    custom_domains: one('SELECT COUNT(*) AS n FROM teams WHERE custom_domain IS NOT NULL'),
    recent_companies: db
      .prepare(
        `SELECT t.id, t.name, t.slug, t.created_at,
                (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id) AS member_count,
                (SELECT COUNT(*) FROM content c WHERE c.team_id = t.id AND c.status = 'published') AS published_count
         FROM teams t ORDER BY t.created_at DESC LIMIT 8`
      )
      .all(),
  });
});

module.exports = router;
