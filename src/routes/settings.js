const express = require('express');

const { getDb } = require('../db');
const { requireSuperadmin } = require('../auth');

const router = express.Router();

const EDITABLE_KEYS = new Set(['site_title', 'site_description', 'allow_registration']);

// Platform-wide settings; per-team settings live under /api/teams/:teamId/settings.
router.get('/', (req, res) => {
  const rows = getDb().prepare('SELECT key, value FROM settings').all();
  res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
});

router.put('/', requireSuperadmin, (req, res) => {
  const db = getDb();
  const stmt = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  for (const [key, value] of Object.entries(req.body || {})) {
    if (EDITABLE_KEYS.has(key)) stmt.run(key, String(value));
  }
  const rows = db.prepare('SELECT key, value FROM settings').all();
  res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
});

module.exports = router;
