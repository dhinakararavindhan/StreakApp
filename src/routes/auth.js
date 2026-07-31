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

const crypto = require('crypto');
const { generateSecret, verifyCode, otpauthUrl } = require('../totp');
const { sendEmail, emailEnabled } = require('../mailer');

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Reset tokens are HMAC-signed and single-use: the signature covers a
// fragment of the current password hash, so changing the password (by
// reset or otherwise) invalidates every outstanding token.
const RESET_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
function signResetToken(user, ttlMs = 60 * 60 * 1000) {
  const exp = Date.now() + ttlMs;
  const payload = `${user.id}.${exp}`;
  const sig = crypto
    .createHmac('sha256', RESET_SECRET)
    .update(`reset:${payload}:${user.password_hash.slice(0, 24)}`)
    .digest('base64url');
  return `${payload}.${sig}`;
}
function verifyResetToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [id, exp, sig] = parts;
  if (Number(exp) < Date.now()) return null;
  const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(Number(id));
  if (!user) return null;
  const expected = crypto
    .createHmac('sha256', RESET_SECRET)
    .update(`reset:${id}.${exp}:${user.password_hash.slice(0, 24)}`)
    .digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return user;
}

router.post('/login', loginLimiter, (req, res) => {
  const { username, password, code } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }
  const user = getDb().prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  // Two-factor: correct password alone doesn't sign you in.
  if (user.totp_enabled) {
    if (!code) return res.json({ twofa_required: true });
    if (!verifyCode(user.totp_secret, code)) {
      return res.status(401).json({ error: 'Invalid authentication code' });
    }
  }
  setAuthCookie(res, issueToken(user));
  res.json({ id: user.id, username: user.username, role: user.role });
});

// ---------- two-factor auth (TOTP) ----------

// Step 1: mint a secret (pending until verified). Shown once, with an
// otpauth:// URL for authenticator apps.
router.post('/2fa/setup', requireAuth, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (user.totp_enabled) return res.status(400).json({ error: '2FA is already enabled' });
  const secret = generateSecret();
  db.prepare('UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?').run(secret, user.id);
  res.json({ secret, otpauth: otpauthUrl(user.username, secret) });
});

// Step 2: prove the authenticator works; only then does 2FA turn on.
router.post('/2fa/verify', requireAuth, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user.totp_secret) return res.status(400).json({ error: 'Run setup first' });
  if (!verifyCode(user.totp_secret, (req.body || {}).code)) {
    return res.status(400).json({ error: 'That code is not valid — check the app and try again' });
  }
  db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(user.id);
  res.json({ ok: true, enabled: true });
});

// Disabling requires a current code — a stolen session can't turn it off.
router.post('/2fa/disable', requireAuth, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user.totp_enabled) return res.status(400).json({ error: '2FA is not enabled' });
  if (!verifyCode(user.totp_secret, (req.body || {}).code)) {
    return res.status(400).json({ error: 'A current authentication code is required to disable 2FA' });
  }
  db.prepare('UPDATE users SET totp_secret = NULL, totp_enabled = 0 WHERE id = ?').run(user.id);
  res.json({ ok: true, enabled: false });
});

// Self-serve signup, so any team can onboard itself. Can be disabled via
// the allow_registration platform setting.
router.post('/register', registerLimiter, (req, res) => {
  const db = getDb();
  const allowed = db.prepare("SELECT value FROM settings WHERE key = 'allow_registration'").get();
  if (allowed && allowed.value !== 'true') {
    return res.status(403).json({ error: 'Registration is disabled — ask an administrator for an account' });
  }
  const { username, password, email } = req.body || {};
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
  let recoveryEmail = null;
  if (email) {
    recoveryEmail = String(email).trim().toLowerCase();
    if (!EMAIL_RE.test(recoveryEmail)) {
      return res.status(400).json({ error: 'That does not look like an email address' });
    }
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(recoveryEmail)) {
      return res.status(409).json({ error: 'That email is already attached to another account' });
    }
  }
  const result = db
    .prepare("INSERT INTO users (username, password_hash, role, email) VALUES (?, ?, 'user', ?)")
    .run(name, bcrypt.hashSync(password, 10), recoveryEmail);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  setAuthCookie(res, issueToken(user));
  res.status(201).json({ id: user.id, username: user.username, role: user.role });
});

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

// ---------- account recovery ----------

const forgotLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, name: 'reset requests' });

// Set (or clear) the account's recovery email.
router.post('/email', requireAuth, (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const db = getDb();
  if (!email) {
    db.prepare('UPDATE users SET email = NULL WHERE id = ?').run(req.user.id);
    return res.json({ ok: true, email: null });
  }
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'That does not look like an email address' });
  const taken = db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(email, req.user.id);
  if (taken) return res.status(409).json({ error: 'That email is already attached to another account' });
  db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, req.user.id);
  res.json({ ok: true, email });
});

// Request a reset link. Always answers 200 — no account enumeration.
router.post('/forgot', forgotLimiter, (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const generic = { ok: true, message: 'If that email belongs to an account, a reset link is on its way.' };
  if (!EMAIL_RE.test(email) || !emailEnabled()) return res.json(generic);
  const user = getDb().prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return res.json(generic);
  const token = signResetToken(user);
  const origin = `${req.protocol}://${req.get('host')}`;
  sendEmail({
    to: email,
    subject: 'Reset your Nova CMS password',
    text:
      `Hi ${user.username},\n\n` +
      `Someone (hopefully you) asked to reset your Nova CMS password.\n\n` +
      `Reset it here (link valid for 1 hour):\n${origin}/admin#/reset/${token}\n\n` +
      `If this wasn't you, ignore this email — your password is unchanged.`,
  }).catch(() => {}); // the response never reveals delivery success
  res.json(generic);
});

// Complete the reset. Tokens are single-use by construction.
router.post('/reset', (req, res) => {
  const { token, password } = req.body || {};
  if (String(password || '').length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  const user = verifyResetToken(token);
  if (!user) return res.status(400).json({ error: 'This reset link is invalid or has expired — request a new one' });
  getDb()
    .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(bcrypt.hashSync(String(password), 10), user.id);
  res.json({ ok: true, username: user.username });
});

// In-app notifications for the signed-in user, newest first.
router.get('/notifications', requireAuth, (req, res) => {
  const { getDb } = require('../db');
  const rows = getDb()
    .prepare(
      `SELECT n.id, n.team_id, t.name AS team_name, n.kind, n.text, n.href, n.read, n.created_at
       FROM notifications n LEFT JOIN teams t ON t.id = n.team_id
       WHERE n.user_id = ? ORDER BY n.id DESC LIMIT 30`
    )
    .all(req.user.id);
  const unread = getDb()
    .prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0')
    .get(req.user.id).n;
  res.json({ unread, notifications: rows });
});

router.post('/notifications/read', requireAuth, (req, res) => {
  const { getDb } = require('../db');
  getDb().prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  const row = getDb().prepare('SELECT totp_enabled, email FROM users WHERE id = ?').get(req.user.id);
  res.json({
    id: req.user.id,
    username: req.user.username,
    role: req.user.role,
    totp_enabled: Boolean(row && row.totp_enabled),
    email: (row && row.email) || null,
  });
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
