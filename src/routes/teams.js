const express = require('express');

const { getDb, uniqueTeamSlug, setTeamDefaults } = require('../db');
const { requireAuth, requireTeamRole } = require('../auth');
const contentRoutes = require('./content');
const tagRoutes = require('./tags');
const mediaRoutes = require('./media');

const router = express.Router();

const TEAM_SETTING_KEYS = new Set([
  'site_title',
  'site_description',
  'theme',
  'accent_color',
  'custom_css',
]);

const DOMAIN_RE = /^(?=.{4,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

function serialize(team) {
  const db = getDb();
  const members = db.prepare('SELECT COUNT(*) AS n FROM team_members WHERE team_id = ?').get(team.id).n;
  const content = db.prepare('SELECT COUNT(*) AS n FROM content WHERE team_id = ?').get(team.id).n;
  return { ...team, member_count: members, content_count: content };
}

// My teams (platform admins see all teams).
router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const rows =
    req.user.role === 'admin'
      ? db.prepare("SELECT t.*, 'owner' AS my_role FROM teams t ORDER BY t.name").all()
      : db
          .prepare(
            `SELECT t.*, tm.role AS my_role FROM teams t
             JOIN team_members tm ON tm.team_id = t.id
             WHERE tm.user_id = ? ORDER BY t.name`
          )
          .all(req.user.id);
  res.json(rows.map(serialize));
});

// Any authenticated user can create a team; they become its owner.
router.post('/', requireAuth, (req, res) => {
  const { name, slug } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
  const db = getDb();
  const finalSlug = uniqueTeamSlug(slug || name);
  const result = db.prepare('INSERT INTO teams (name, slug) VALUES (?, ?)').run(String(name).trim(), finalSlug);
  db.prepare('INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)').run(
    result.lastInsertRowid,
    req.user.id,
    'owner'
  );
  setTeamDefaults(result.lastInsertRowid, String(name).trim());
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ ...serialize(team), my_role: 'owner' });
});

router.get('/:teamId', requireTeamRole('editor'), (req, res) => {
  res.json({ ...serialize(req.team), my_role: req.teamRole });
});

router.put('/:teamId', requireTeamRole('owner'), (req, res) => {
  const { name, slug, custom_domain } = req.body || {};
  const db = getDb();
  const newName = name !== undefined && String(name).trim() ? String(name).trim() : req.team.name;
  const newSlug = slug !== undefined || name !== undefined
    ? uniqueTeamSlug(slug || newName, req.team.id)
    : req.team.slug;

  let newDomain = req.team.custom_domain;
  if (custom_domain !== undefined) {
    const domain = String(custom_domain).trim().toLowerCase();
    if (!domain) {
      newDomain = null;
    } else {
      if (!DOMAIN_RE.test(domain)) {
        return res.status(400).json({ error: 'custom_domain must be a valid hostname like www.example.com' });
      }
      const taken = db
        .prepare('SELECT 1 FROM teams WHERE custom_domain = ? AND id != ?')
        .get(domain, req.team.id);
      if (taken) return res.status(409).json({ error: 'That domain is already connected to another team' });
      newDomain = domain;
    }
  }

  db.prepare('UPDATE teams SET name = ?, slug = ?, custom_domain = ? WHERE id = ?').run(
    newName,
    newSlug,
    newDomain,
    req.team.id
  );
  res.json(serialize(db.prepare('SELECT * FROM teams WHERE id = ?').get(req.team.id)));
});

router.delete('/:teamId', requireTeamRole('owner'), (req, res) => {
  getDb().prepare('DELETE FROM teams WHERE id = ?').run(req.team.id);
  res.json({ ok: true });
});

// ---------- members ----------

router.get('/:teamId/members', requireTeamRole('editor'), (req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT u.id, u.username, tm.role, tm.created_at FROM team_members tm
       JOIN users u ON u.id = tm.user_id WHERE tm.team_id = ? ORDER BY u.username`
    )
    .all(req.team.id);
  res.json(rows);
});

// Add a member by username (they must already have an account).
router.post('/:teamId/members', requireTeamRole('owner'), (req, res) => {
  const { username, role = 'editor' } = req.body || {};
  if (!username) return res.status(400).json({ error: 'username is required' });
  if (!['owner', 'editor'].includes(role)) {
    return res.status(400).json({ error: 'role must be owner or editor' });
  }
  const db = getDb();
  const user = db.prepare('SELECT id, username FROM users WHERE username = ?').get(username);
  if (!user) return res.status(404).json({ error: `No account named "${username}" — they need to register first` });
  if (db.prepare('SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?').get(req.team.id, user.id)) {
    return res.status(409).json({ error: 'Already a member of this team' });
  }
  db.prepare('INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)').run(req.team.id, user.id, role);
  res.status(201).json({ id: user.id, username: user.username, role });
});

router.put('/:teamId/members/:userId', requireTeamRole('owner'), (req, res) => {
  const { role } = req.body || {};
  if (!['owner', 'editor'].includes(role)) {
    return res.status(400).json({ error: 'role must be owner or editor' });
  }
  const db = getDb();
  if (role === 'editor' && wouldRemoveLastOwner(db, req.team.id, Number(req.params.userId))) {
    return res.status(400).json({ error: 'A team must keep at least one owner' });
  }
  const result = db
    .prepare('UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?')
    .run(role, req.team.id, req.params.userId);
  if (result.changes === 0) return res.status(404).json({ error: 'Not a member' });
  res.json({ ok: true });
});

// Owners can remove anyone; members can remove themselves (leave).
router.delete('/:teamId/members/:userId', requireTeamRole('editor'), (req, res) => {
  const targetId = Number(req.params.userId);
  const isSelf = targetId === req.user.id;
  if (!isSelf && req.teamRole !== 'owner') {
    return res.status(403).json({ error: 'Team owner access required' });
  }
  const db = getDb();
  if (wouldRemoveLastOwner(db, req.team.id, targetId)) {
    return res.status(400).json({ error: 'A team must keep at least one owner' });
  }
  const result = db
    .prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?')
    .run(req.team.id, targetId);
  if (result.changes === 0) return res.status(404).json({ error: 'Not a member' });
  res.json({ ok: true });
});

function wouldRemoveLastOwner(db, teamId, userId) {
  const target = db
    .prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?')
    .get(teamId, userId);
  if (!target || target.role !== 'owner') return false;
  const owners = db
    .prepare("SELECT COUNT(*) AS n FROM team_members WHERE team_id = ? AND role = 'owner'")
    .get(teamId).n;
  return owners <= 1;
}

// ---------- team settings ----------

router.get('/:teamId/settings', requireTeamRole('editor'), (req, res) => {
  const rows = getDb()
    .prepare('SELECT key, value FROM team_settings WHERE team_id = ?')
    .all(req.team.id);
  res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
});

router.put('/:teamId/settings', requireTeamRole('owner'), (req, res) => {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO team_settings (team_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(team_id, key) DO UPDATE SET value = excluded.value`
  );
  for (const [key, value] of Object.entries(req.body || {})) {
    if (TEAM_SETTING_KEYS.has(key)) stmt.run(req.team.id, key, String(value));
  }
  const rows = db.prepare('SELECT key, value FROM team_settings WHERE team_id = ?').all(req.team.id);
  res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
});

// ---------- team-scoped resources ----------

router.use('/:teamId/content', requireTeamRole('editor'), contentRoutes);
router.use('/:teamId/tags', requireTeamRole('editor'), tagRoutes);
router.use('/:teamId/media', requireTeamRole('editor'), mediaRoutes);

module.exports = router;
