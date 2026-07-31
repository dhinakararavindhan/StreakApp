const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const { getDb } = require('./db');

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
    // Enable when serving over HTTPS (COOKIE_SECURE=1).
    secure: process.env.COOKIE_SECURE === '1',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

/** Populates req.user (cookie) or req.apiKey (Bearer token); never rejects. */
function attachUser(req, res, next) {
  const token = req.cookies[COOKIE_NAME];
  if (token) {
    try {
      req.user = jwt.verify(token, JWT_SECRET);
    } catch {
      // expired or invalid — treat as logged out
    }
  }
  const authz = req.headers.authorization || '';
  if (!req.user && authz.startsWith('Bearer nova_')) {
    const hash = crypto.createHash('sha256').update(authz.slice(7)).digest('hex');
    const key = getDb().prepare('SELECT * FROM api_keys WHERE token_hash = ?').get(hash);
    if (key) {
      req.apiKey = key;
      getDb().prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?").run(key.id);
    }
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  next();
}

/** Platform operators only. */
function requireSuperadmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Superadmin access required' });
  }
  next();
}

/**
 * Gate a route on membership in the company named by :teamId.
 * Sets req.team and req.teamRole. Superadmins pass as 'admin'.
 * requiredRole: 'manager' (any member) or 'admin' (company owner).
 */
function requireTeamRole(requiredRole = 'manager') {
  return (req, res, next) => {
    if (!req.user && !req.apiKey) return res.status(401).json({ error: 'Authentication required' });
    const db = getDb();
    const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.teamId);
    if (!team) return res.status(404).json({ error: 'Company not found' });
    req.team = team;

    // API keys are company-scoped, never admin: a read key allows GETs, a
    // write key acts as a manager (so its writes go through approval).
    if (!req.user && req.apiKey) {
      if (req.apiKey.team_id !== team.id) {
        return res.status(403).json({ error: 'API key belongs to a different company' });
      }
      if (requiredRole === 'admin') {
        return res.status(403).json({ error: 'API keys cannot perform admin actions' });
      }
      if (req.apiKey.scope === 'read' && req.method !== 'GET') {
        return res.status(403).json({ error: 'This API key is read-only' });
      }
      req.teamRole = 'manager';
      req.user = { id: null, username: `api:${req.apiKey.name}`, role: 'user' };
      return next();
    }

    if (req.user.role === 'superadmin') {
      req.teamRole = 'admin';
      return next();
    }
    const membership = db
      .prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?')
      .get(team.id, req.user.id);
    if (!membership) return res.status(403).json({ error: 'You are not a member of this company' });
    if (requiredRole === 'admin' && membership.role !== 'admin') {
      return res.status(403).json({ error: 'Company admin access required' });
    }
    req.teamRole = membership.role;
    next();
  };
}

// ---------- signed share tokens (preview links for outsiders) ----------

/** Mint an HMAC-signed, expiring token for sharing one content item. */
function signShareToken(contentId, days = 14) {
  const exp = Date.now() + Math.min(30, Math.max(1, days)) * 24 * 60 * 60 * 1000;
  const payload = `${contentId}.${exp}`;
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`share:${payload}`).digest('base64url');
  return `${payload}.${sig}`;
}

/** Verify a share token. Returns {contentId, exp} or null (bad/expired). */
function verifyShareToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [id, exp, sig] = parts;
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(`share:${id}.${exp}`).digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  if (Number(exp) < Date.now()) return null;
  return { contentId: Number(id), exp: Number(exp) };
}

module.exports = {
  issueToken,
  setAuthCookie,
  clearAuthCookie,
  attachUser,
  requireAuth,
  requireSuperadmin,
  requireTeamRole,
  signShareToken,
  verifyShareToken,
};
