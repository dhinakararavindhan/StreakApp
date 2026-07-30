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
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const db = getDb();
    const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.teamId);
    if (!team) return res.status(404).json({ error: 'Company not found' });
    req.team = team;

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

module.exports = {
  issueToken,
  setAuthCookie,
  clearAuthCookie,
  attachUser,
  requireAuth,
  requireSuperadmin,
  requireTeamRole,
};
