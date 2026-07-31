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
        `SELECT t.id, t.name, t.slug, t.plan, t.created_at,
                (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id) AS member_count,
                (SELECT COUNT(*) FROM content c WHERE c.team_id = t.id AND c.status = 'published') AS published_count
         FROM teams t ORDER BY t.created_at DESC LIMIT 8`
      )
      .all(),
  });
});

// One-click consistent database backup: a point-in-time snapshot of the
// whole platform as a SQLite file. Works on live databases (better-sqlite3
// serializes atomically). Restore = drop the file in DATA_DIR as cms.sqlite.
router.get('/backup', requireSuperadmin, (req, res) => {
  const snapshot = getDb().serialize();
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  res.set('Content-Type', 'application/octet-stream');
  res.set('Content-Disposition', `attachment; filename="nova-backup-${stamp}.sqlite"`);
  res.send(Buffer.from(snapshot.buffer, snapshot.byteOffset, snapshot.byteLength));
});

// Set a company's plan — this is where a billing provider (Stripe
// webhook -> this endpoint) plugs in.
const { PLANS } = require('../plans');
router.put('/teams/:teamId/plan', requireSuperadmin, (req, res) => {
  const { plan } = req.body || {};
  if (!PLANS[plan]) return res.status(400).json({ error: `plan must be one of: ${Object.keys(PLANS).join(', ')}` });
  const result = getDb().prepare('UPDATE teams SET plan = ? WHERE id = ?').run(plan, req.params.teamId);
  if (result.changes === 0) return res.status(404).json({ error: 'Company not found' });
  res.json({ ok: true, plan });
});

module.exports = router;
