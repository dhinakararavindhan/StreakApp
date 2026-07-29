const express = require('express');
const { marked } = require('marked');

const { getDb } = require('../db');

const router = express.Router();

// Theme presets a team can pick for its site. 'default' follows the
// visitor's light/dark preference; the rest are fixed brand looks.
const THEMES = {
  default: null, // handled via prefers-color-scheme below
  midnight: { bg: '#0f1115', fg: '#e5e7eb', muted: '#98a2b3', border: '#2a2f3a', accent: '#60a5fa' },
  paper: { bg: '#faf7f0', fg: '#292420', muted: '#8a7f70', border: '#e6ddcc', accent: '#b45309' },
  forest: { bg: '#f6faf7', fg: '#14281d', muted: '#5c6f60', border: '#d8e4da', accent: '#166534' },
  ocean: { bg: '#f4f8fb', fg: '#0f2537', muted: '#5b7387', border: '#d4e2ec', accent: '#0e7490' },
};

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function platformSettings() {
  const rows = getDb().prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

function teamSettings(teamId) {
  const rows = getDb().prepare('SELECT key, value FROM team_settings WHERE team_id = ?').all(teamId);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

function themeCss(settings = {}) {
  const preset = THEMES[settings.theme] || null;
  const accent = /^#[0-9a-f]{3,8}$/i.test(settings.accent_color || '') ? settings.accent_color : null;
  let css;
  if (preset) {
    css = `:root { --fg: ${preset.fg}; --muted: ${preset.muted}; --accent: ${accent || preset.accent}; --bg: ${preset.bg}; --border: ${preset.border}; }`;
  } else {
    css = `:root { --fg: #1a1a1a; --muted: #666; --accent: ${accent || '#2563eb'}; --bg: #fff; --border: #e5e5e5; }
  @media (prefers-color-scheme: dark) {
    :root { --fg: #e5e5e5; --muted: #999; --accent: ${accent || '#60a5fa'}; --bg: #111; --border: #333; }
  }`;
  }
  // Per-team CSS is scoped to that team's own pages; just prevent tag breakout.
  const custom = String(settings.custom_css || '').replace(/<\/(style|script)/gi, '');
  return `${css}\n${custom}`;
}

function layout({ title, siteTitle, siteDescription, homeHref, nav = '', content, settings }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title ? `${title} — ${siteTitle}` : siteTitle)}</title>
<style>
  ${themeCss(settings)}
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, sans-serif; color: var(--fg); background: var(--bg); line-height: 1.6; }
  header { border-bottom: 1px solid var(--border); }
  .wrap { max-width: 720px; margin: 0 auto; padding: 1rem 1.25rem; }
  header .wrap { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; flex-wrap: wrap; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  h1.site { font-size: 1.25rem; margin: 0; }
  h1.site a { color: var(--fg); }
  nav a { margin-left: 1rem; color: var(--muted); }
  main.wrap { padding-top: 2rem; padding-bottom: 3rem; }
  article + article { margin-top: 2.5rem; }
  .meta { color: var(--muted); font-size: 0.875rem; }
  .tag { display: inline-block; background: var(--border); color: var(--fg); border-radius: 999px; padding: 0 0.6em; font-size: 0.8rem; margin-right: 0.35em; }
  img { max-width: 100%; }
  pre { overflow-x: auto; background: var(--border); padding: 1rem; border-radius: 6px; }
  footer { border-top: 1px solid var(--border); color: var(--muted); font-size: 0.875rem; }
  ul.teams { list-style: none; padding: 0; }
  ul.teams li { border: 1px solid var(--border); border-radius: 8px; padding: 0.9rem 1.1rem; margin-bottom: 0.75rem; }
  ul.teams .meta { margin-top: 0.15rem; }
</style>
</head>
<body>
<header><div class="wrap">
  <h1 class="site"><a href="${esc(homeHref)}">${esc(siteTitle)}</a></h1>
  <nav>${nav}</nav>
</div></header>
<main class="wrap">${content}</main>
<footer><div class="wrap">${esc(siteDescription)}</div></footer>
</body>
</html>`;
}

/** Base path for a team's links: '' on its custom domain, /t/<slug> otherwise. */
function teamBase(team, onDomain) {
  return onDomain ? '' : `/t/${team.slug}`;
}

function teamNav(team, base, onDomain) {
  const pages = getDb()
    .prepare(
      "SELECT title, slug FROM content WHERE team_id = ? AND type = 'page' AND status = 'published' ORDER BY title"
    )
    .all(team.id);
  const links = pages.map((p) => `<a href="${esc(base)}/${esc(p.slug)}">${esc(p.title)}</a>`).join('');
  // On a company's own domain, don't advertise the platform directory.
  return onDomain ? links : links + '<a href="/">All teams</a>';
}

function renderArticle(team, row, { full, base }) {
  const tags = getDb()
    .prepare(
      'SELECT t.name, t.slug FROM tags t JOIN content_tags ct ON ct.tag_id = t.id WHERE ct.content_id = ?'
    )
    .all(row.id);
  const date = (row.published_at || row.created_at || '').slice(0, 10);
  const tagHtml = tags
    .map((t) => `<a class="tag" href="${esc(base)}${base ? '' : '/'}?tag=${esc(t.slug)}">${esc(t.name)}</a>`)
    .join('');
  const heading = full
    ? `<h1>${esc(row.title)}</h1>`
    : `<h2><a href="${esc(base)}/posts/${esc(row.slug)}">${esc(row.title)}</a></h2>`;
  const body = full
    ? marked.parse(row.body)
    : `<p>${esc(row.excerpt || row.body.replace(/[#*_`>\[\]]/g, '').slice(0, 200))}</p>`;
  const meta = row.type === 'post' ? `<div class="meta">${esc(date)} ${tagHtml}</div>` : '';
  return `<article>${heading}${meta}${body}</article>`;
}

function teamLayout(team, onDomain, { title, content }) {
  const s = teamSettings(team.id);
  const base = teamBase(team, onDomain);
  return layout({
    title,
    siteTitle: s.site_title || team.name,
    siteDescription: s.site_description || '',
    homeHref: base || '/',
    nav: teamNav(team, base, onDomain),
    content,
    settings: s,
  });
}

function findTeam(slug) {
  return getDb().prepare('SELECT * FROM teams WHERE slug = ?').get(slug);
}

function renderTeamHome(team, onDomain, req, res) {
  const { tag } = req.query;
  const params = [team.id];
  let filter = '';
  if (tag) {
    filter =
      'AND id IN (SELECT ct.content_id FROM content_tags ct JOIN tags t ON t.id = ct.tag_id WHERE t.team_id = ? AND t.slug = ?)';
    params.push(team.id, tag);
  }
  const posts = getDb()
    .prepare(
      `SELECT * FROM content WHERE team_id = ? AND type = 'post' AND status = 'published' ${filter}
       ORDER BY published_at DESC`
    )
    .all(...params);
  const base = teamBase(team, onDomain);
  const content = posts.length
    ? posts.map((p) => renderArticle(team, p, { full: false, base })).join('')
    : '<p>No posts yet.</p>';
  res.send(teamLayout(team, onDomain, { title: tag ? `Tag: ${tag}` : '', content }));
}

function renderTeamPost(team, onDomain, slug, res) {
  const row = getDb()
    .prepare("SELECT * FROM content WHERE team_id = ? AND type = 'post' AND status = 'published' AND slug = ?")
    .get(team.id, slug);
  if (!row) {
    return res
      .status(404)
      .send(teamLayout(team, onDomain, { title: 'Not found', content: '<h1>404</h1><p>Post not found.</p>' }));
  }
  const base = teamBase(team, onDomain);
  res.send(teamLayout(team, onDomain, { title: row.title, content: renderArticle(team, row, { full: true, base }) }));
}

function renderTeamPage(team, onDomain, slug, res) {
  const row = getDb()
    .prepare("SELECT * FROM content WHERE team_id = ? AND type = 'page' AND status = 'published' AND slug = ?")
    .get(team.id, slug);
  if (!row) {
    return res
      .status(404)
      .send(teamLayout(team, onDomain, { title: 'Not found', content: '<h1>404</h1><p>Page not found.</p>' }));
  }
  const base = teamBase(team, onDomain);
  res.send(teamLayout(team, onDomain, { title: row.title, content: renderArticle(team, row, { full: true, base }) }));
}

// ---------- headless content API (public, CORS-open, published only) ----------
// Companies that keep their own frontend can pull content from here.

function publicContentRow(row, { withBody }) {
  const tags = getDb()
    .prepare('SELECT t.name, t.slug FROM tags t JOIN content_tags ct ON ct.tag_id = t.id WHERE ct.content_id = ?')
    .all(row.id);
  const base = {
    id: row.id,
    type: row.type,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt,
    tags,
    published_at: row.published_at,
    updated_at: row.updated_at,
  };
  if (withBody) {
    base.body = row.body;
    base.body_html = marked.parse(row.body);
  }
  return base;
}

const cors = (req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  next();
};

router.get('/api/public/:team', cors, (req, res) => {
  const team = findTeam(req.params.team);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  const s = teamSettings(team.id);
  res.json({
    name: team.name,
    slug: team.slug,
    site_title: s.site_title || team.name,
    site_description: s.site_description || '',
  });
});

router.get('/api/public/:team/content', cors, (req, res) => {
  const team = findTeam(req.params.team);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  const { type, tag } = req.query;
  const where = ["team_id = ?", "status = 'published'"];
  const params = [team.id];
  if (type) { where.push('type = ?'); params.push(type); }
  if (tag) {
    where.push(
      'id IN (SELECT ct.content_id FROM content_tags ct JOIN tags t ON t.id = ct.tag_id WHERE t.team_id = ? AND t.slug = ?)'
    );
    params.push(team.id, tag);
  }
  const rows = getDb()
    .prepare(`SELECT * FROM content WHERE ${where.join(' AND ')} ORDER BY published_at DESC`)
    .all(...params);
  res.json(rows.map((r) => publicContentRow(r, { withBody: false })));
});

router.get('/api/public/:team/content/:slug', cors, (req, res) => {
  const team = findTeam(req.params.team);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  const row = getDb()
    .prepare("SELECT * FROM content WHERE team_id = ? AND status = 'published' AND slug = ?")
    .get(team.id, req.params.slug);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(publicContentRow(row, { withBody: true }));
});

// ---------- custom-domain resolution ----------
// A request whose Host matches a team's connected domain serves that
// team's site at the domain root.

router.use((req, res, next) => {
  const host = String(req.hostname || '').toLowerCase();
  if (host) {
    req.domainTeam = getDb().prepare('SELECT * FROM teams WHERE custom_domain = ?').get(host) || null;
  }
  next();
});

// ---------- HTML site ----------

// Root: a company's site home on its own domain, the team directory otherwise.
router.get('/', (req, res) => {
  if (req.domainTeam) return renderTeamHome(req.domainTeam, true, req, res);

  const s = platformSettings();
  const teams = getDb()
    .prepare(
      `SELECT t.*, COUNT(c.id) AS published_count FROM teams t
       LEFT JOIN content c ON c.team_id = t.id AND c.status = 'published'
       GROUP BY t.id ORDER BY t.name`
    )
    .all();
  const content = `
    <h1>Team sites</h1>
    ${teams.length
      ? `<ul class="teams">${teams
          .map(
            (t) => `<li><a href="/t/${esc(t.slug)}"><b>${esc(t.name)}</b></a>
              <div class="meta">${t.published_count} published item(s)</div></li>`
          )
          .join('')}</ul>`
      : '<p>No teams yet.</p>'}
    <p class="meta">Have a team? <a href="/admin">Sign in or create an account</a> to start publishing.</p>`;
  res.send(
    layout({
      title: '',
      siteTitle: s.site_title,
      siteDescription: s.site_description,
      homeHref: '/',
      nav: '<a href="/admin">Admin</a>',
      content,
      settings: {},
    })
  );
});

// Custom-domain post/page URLs at the domain root.
router.get('/posts/:slug', (req, res, next) => {
  if (!req.domainTeam) return next();
  renderTeamPost(req.domainTeam, true, req.params.slug, res);
});

// Path-based team sites (always available, custom domain or not).
router.get('/t/:team', (req, res) => {
  const team = findTeam(req.params.team);
  if (!team) return res.status(404).send('Team not found');
  renderTeamHome(team, false, req, res);
});

router.get('/t/:team/posts/:slug', (req, res) => {
  const team = findTeam(req.params.team);
  if (!team) return res.status(404).send('Team not found');
  renderTeamPost(team, false, req.params.slug, res);
});

router.get('/t/:team/:slug', (req, res) => {
  const team = findTeam(req.params.team);
  if (!team) return res.status(404).send('Team not found');
  renderTeamPage(team, false, req.params.slug, res);
});

// Custom-domain pages at the domain root: /about, /pricing, …
router.get('/:slug', (req, res, next) => {
  if (!req.domainTeam) return next();
  renderTeamPage(req.domainTeam, true, req.params.slug, res);
});

module.exports = router;
