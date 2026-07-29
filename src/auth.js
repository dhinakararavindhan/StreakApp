const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const COOKIE_NAME = 'cms_token';
const TOKEN_TTL = '7d';

function issueToken(user) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, {
    expiresIn: TOKEN_TTL,
  });
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

/** Populates req.user if a valid token cookie is present; never rejects. */
function attachUser(req, res, next) {
  const token = req.cookies[COOKIE_NAME];
  if (token) {
    try {
      req.user = jwt.verify(token, JWT_SECRET);
    } catch {
      // expired or invalid — treat as logged out
    }
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

module.exports = { issueToken, setAuthCookie, clearAuthCookie, attachUser, requireAuth, requireAdmin };
