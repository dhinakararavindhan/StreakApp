const express = require('express');
const bcrypt = require('bcryptjs');

const { getDb } = require('../db');
const { issueToken, setAuthCookie, clearAuthCookie, requireAuth } = require('../auth');
const { rateLimit } = require('../security');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_LOGIN || 30),
  name: 'sign-in attempts',
});
const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_REGISTER || 30),
  name: 'registrations',
});

router.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }
  const user = getDb().prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  setAuthCookie(res, issueToken(user));
  res.json({ id: user.id, username: user.username, role: user.role });
});

// Self-serve signup, so any team can onboard itself. Can be disabled via
// the allow_registration platform setting.
router.post('/register', registerLimiter, (req, res) => {
  const db = getDb();
  const allowed = db.prepare("SELECT value FROM settings WHERE key = 'allow_registration'").get();
  if (allowed && allowed.value !== 'true') {
    return res.status(403).json({ error: 'Registration is disabled — ask an administrator for an account' });
  }
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }
  const name = String(username).trim();
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(name)) {
    return res.status(400).json({ error: 'Username must be 3-32 characters (letters, digits, _ . -)' });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(name)) {
    return res.status(409).json({ error: 'Username already taken' });
  }
  const result = db
    .prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'user')")
    .run(name, bcrypt.hashSync(password, 10));
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  setAuthCookie(res, issueToken(user));
  res.status(201).json({ id: user.id, username: user.username, role: user.role });
});

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ id: req.user.id, username: req.user.username, role: req.user.role });
});

router.post('/password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required' });
  }
  if (String(newPassword).length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
    bcrypt.hashSync(newPassword, 10),
    user.id
  );
  res.json({ ok: true });
});

module.exports = router;
