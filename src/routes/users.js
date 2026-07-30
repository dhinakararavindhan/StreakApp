const express = require('express');
const bcrypt = require('bcryptjs');

const { getDb } = require('../db');
const { requireSuperadmin } = require('../auth');

// Platform-level user administration (superadmins only). Company
// membership is managed per company under /api/teams/:teamId/members.
const router = express.Router();

router.get('/', requireSuperadmin, (req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT u.id, u.username, u.role, u.created_at,
              COUNT(tm.team_id) AS team_count
       FROM users u LEFT JOIN team_members tm ON tm.user_id = u.id
       GROUP BY u.id ORDER BY u.username`
    )
    .all();
  res.json(rows);
});

router.post('/', requireSuperadmin, (req, res) => {
  const { username, password, role = 'user' } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  if (!['superadmin', 'user'].includes(role)) {
    return res.status(400).json({ error: 'role must be superadmin or user' });
  }
  const db = getDb();
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
    return res.status(409).json({ error: 'Username already taken' });
  }
  const result = db
    .prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
    .run(username, bcrypt.hashSync(password, 10), role);
  const row = db
    .prepare('SELECT id, username, role, created_at FROM users WHERE id = ?')
    .get(result.lastInsertRowid);
  res.status(201).json(row);
});

router.delete('/:id', requireSuperadmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account' });
  const result = getDb().prepare('DELETE FROM users WHERE id = ?').run(id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

module.exports = router;
