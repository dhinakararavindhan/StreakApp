const express = require('express');
const { marked } = require('marked');

const { getDb } = require('../db');

const router = express.Router();

// Theme presets a company can pick for its site. 'default' follows the
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
  // Per-company CSS is scoped to that company's own pages; just prevent tag breakout.
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
  @font-face { font-family: 'Geist Sans'; font-weight: 400; font-display: swap; src: url('/assets/fonts/geist-sans-latin-400-normal.woff2') format('woff2'); }
  @font-face { font-family: 'Geist Sans'; font-weight: 600; font-display: swap; src: url('/assets/fonts/geist-sans-latin-600-normal.woff2') format('woff2'); }
  @font-face { font-family: 'Geist Sans'; font-weight: 800; font-display: swap; src: url('/assets/fonts/geist-sans-latin-800-normal.woff2') format('woff2'); }
  ${themeCss(settings)}
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Geist Sans', system-ui, sans-serif; -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; color: var(--fg); background: var(--bg); line-height: 1.65; }
  header.top {
    position: sticky; top: 0; z-index: 10;
    background: color-mix(in srgb, var(--bg) 82%, transparent);
    backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--border);
  }
  .wrap { max-width: 820px; margin: 0 auto; padding: 1rem 1.5rem; }
  header.top .wrap { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; flex-wrap: wrap; padding-top: 0.85rem; padding-bottom: 0.85rem; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  h1.site { font-size: 1.15rem; margin: 0; letter-spacing: -0.01em; }
  h1.site a { color: var(--fg); }
  nav a { margin-left: 1.1rem; color: var(--muted); font-size: 0.95rem; }
  .hero { padding: 3.25rem 0 0.5rem; }
  .hero h1 { font-size: clamp(1.8rem, 5vw, 2.6rem); margin: 0 0 0.4rem; letter-spacing: -0.03em; line-height: 1.15; }
  .hero p { color: var(--muted); font-size: 1.05rem; margin: 0; }
  .hero .rule { height: 3px; width: 64px; background: var(--accent); border-radius: 2px; margin-top: 1.5rem; }
  main.wrap { padding-top: 1rem; padding-bottom: 4rem; }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 1.25rem; margin-top: 2rem; }
  .card {
    border: 1px solid var(--border); border-radius: 14px; overflow: hidden;
    background: color-mix(in srgb, var(--fg) 3%, var(--bg));
    transition: transform 0.15s ease, box-shadow 0.15s ease;
    display: flex; flex-direction: column;
  }
  .card:hover { transform: translateY(-3px); box-shadow: 0 12px 32px color-mix(in srgb, var(--fg) 10%, transparent); }
  .card .cover { width: 100%; height: 140px; object-fit: cover; display: block; background: var(--border); }
  .card .cover.placeholder { display: grid; place-items: center; color: var(--muted); font-size: 1.6rem; background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 22%, var(--bg)), color-mix(in srgb, var(--accent) 6%, var(--bg))); }
  .card .pad { padding: 1rem 1.1rem 1.15rem; display: flex; flex-direction: column; gap: 0.4rem; flex: 1; }
  .card h2 { font-size: 1.05rem; margin: 0; letter-spacing: -0.01em; }
  .card h2 a { color: var(--fg); }
  .card p { margin: 0; color: var(--muted); font-size: 0.9rem; flex: 1; }
  .meta { color: var(--muted); font-size: 0.85rem; }
  .tag { display: inline-block; background: color-mix(in srgb, var(--accent) 14%, var(--bg)); color: var(--accent); border-radius: 999px; padding: 0.05rem 0.65em; font-size: 0.78rem; margin-right: 0.35em; }
  article.full { padding-top: 2.5rem; }
  article.full .cover-hero { width: 100%; max-height: 340px; object-fit: cover; border-radius: 16px; margin-bottom: 2rem; }
  article.full h1 { font-size: clamp(1.7rem, 4.5vw, 2.4rem); letter-spacing: -0.03em; margin: 0 0 0.5rem; line-height: 1.15; }
  article.full .meta { margin-bottom: 2rem; }
  article.full img { max-width: 100%; border-radius: 10px; }
  pre { overflow-x: auto; background: color-mix(in srgb, var(--fg) 6%, var(--bg)); border: 1px solid var(--border); padding: 1rem; border-radius: 10px; }
  code { background: color-mix(in srgb, var(--fg) 6%, var(--bg)); border-radius: 4px; padding: 0.1em 0.35em; font-size: 0.9em; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid var(--accent); margin-left: 0; padding-left: 1.25rem; color: var(--muted); }
  footer { border-top: 1px solid var(--border); color: var(--muted); font-size: 0.875rem; }
</style>
</head>
<body>
<header class="top"><div class="wrap">
  <h1 class="site"><a href="${esc(homeHref)}">${esc(siteTitle)}</a></h1>
  <nav>${nav}</nav>
</div></header>
<main class="wrap">${content}</main>
<footer><div class="wrap">${esc(siteDescription)}</div></footer>
</body>
</html>`;
}

/** Base path for a company's links: '' on its custom domain, /t/<slug> otherwise. */
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
  return onDomain ? links : links + '<a href="/">All sites</a>';
}

function tagLinks(row, base) {
  const tags = getDb()
    .prepare(
      'SELECT t.name, t.slug FROM tags t JOIN content_tags ct ON ct.tag_id = t.id WHERE ct.content_id = ?'
    )
    .all(row.id);
  return tags
    .map((t) => `<a class="tag" href="${esc(base)}${base ? '' : '/'}?tag=${esc(t.slug)}">${esc(t.name)}</a>`)
    .join('');
}

function postCard(team, row, base) {
  const date = (row.published_at || row.created_at || '').slice(0, 10);
  const href = `${base}/posts/${row.slug}`;
  const cover = row.cover_image
    ? `<img class="cover" src="${esc(row.cover_image)}" alt="">`
    : `<div class="cover placeholder">✶</div>`;
  const excerpt = row.excerpt || row.body.replace(/[#*_`>\[\]]/g, '').slice(0, 140);
  return `<div class="card">
    <a href="${esc(href)}">${cover}</a>
    <div class="pad">
      <h2><a href="${esc(href)}">${esc(row.title)}</a></h2>
      <p>${esc(excerpt)}</p>
      <div class="meta">${esc(date)} ${tagLinks(row, base)}</div>
    </div>
  </div>`;
}

function fullArticle(team, row, base) {
  const date = (row.published_at || row.created_at || '').slice(0, 10);
  const cover = row.cover_image ? `<img class="cover-hero" src="${esc(row.cover_image)}" alt="">` : '';
  const meta = row.type === 'post' ? `<div class="meta">${esc(date)} ${tagLinks(row, base)}</div>` : '';
  return `<article class="full">${cover}<h1>${esc(row.title)}</h1>${meta}${marked.parse(row.body)}</article>`;
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
  const s = teamSettings(team.id);
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
  const hero = `<div class="hero">
    <h1>${esc(s.site_title || team.name)}</h1>
    <p>${esc(tag ? `Tagged “${tag}”` : s.site_description || '')}</p>
    <div class="rule"></div>
  </div>`;
  const content = posts.length
    ? `${hero}<div class="cards">${posts.map((p) => postCard(team, p, base)).join('')}</div>`
    : `${hero}<p class="meta" style="margin-top:2rem">No posts yet.</p>`;
  res.send(teamLayout(team, onDomain, { title: tag ? `Tag: ${tag}` : '', content }));
}

function renderTeamPost(team, onDomain, slug, res) {
  const row = getDb()
    .prepare("SELECT * FROM content WHERE team_id = ? AND type = 'post' AND status = 'published' AND slug = ?")
    .get(team.id, slug);
  if (!row) {
    return res
      .status(404)
      .send(teamLayout(team, onDomain, { title: 'Not found', content: '<div class="hero"><h1>404</h1><p>Post not found.</p></div>' }));
  }
  const base = teamBase(team, onDomain);
  res.send(teamLayout(team, onDomain, { title: row.title, content: fullArticle(team, row, base) }));
}

function renderTeamPage(team, onDomain, slug, res) {
  const row = getDb()
    .prepare("SELECT * FROM content WHERE team_id = ? AND type = 'page' AND status = 'published' AND slug = ?")
    .get(team.id, slug);
  if (!row) {
    return res
      .status(404)
      .send(teamLayout(team, onDomain, { title: 'Not found', content: '<div class="hero"><h1>404</h1><p>Page not found.</p></div>' }));
  }
  const base = teamBase(team, onDomain);
  res.send(teamLayout(team, onDomain, { title: row.title, content: fullArticle(team, row, base) }));
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
    cover_image: row.cover_image,
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
  if (!team) return res.status(404).json({ error: 'Company not found' });
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
  if (!team) return res.status(404).json({ error: 'Company not found' });
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
  if (!team) return res.status(404).json({ error: 'Company not found' });
  const row = getDb()
    .prepare("SELECT * FROM content WHERE team_id = ? AND status = 'published' AND slug = ?")
    .get(team.id, req.params.slug);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(publicContentRow(row, { withBody: true }));
});

// ---------- custom-domain resolution ----------
// A request whose Host matches a company's connected domain serves that
// company's site at the domain root.

router.use((req, res, next) => {
  const host = String(req.hostname || '').toLowerCase();
  if (host) {
    req.domainTeam = getDb().prepare('SELECT * FROM teams WHERE custom_domain = ?').get(host) || null;
  }
  next();
});

// ---------- HTML site ----------

// Root: a company's site home on its own domain, the directory otherwise.
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
    <div class="hero">
      <h1>${esc(s.site_title)}</h1>
      <p>${esc(s.site_description)}</p>
      <div class="rule"></div>
    </div>
    ${teams.length
      ? `<div class="cards">${teams
          .map(
            (t) => `<div class="card">
              <a href="/t/${esc(t.slug)}"><div class="cover placeholder">◈</div></a>
              <div class="pad">
                <h2><a href="/t/${esc(t.slug)}">${esc(t.name)}</a></h2>
                <p>${t.published_count} published item(s)</p>
              </div>
            </div>`
          )
          .join('')}</div>`
      : '<p class="meta" style="margin-top:2rem">No companies yet.</p>'}
    <p class="meta" style="margin-top:2.5rem">Have a company? <a href="/admin">Sign in or create an account</a> to start publishing.</p>`;
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

// Path-based company sites (always available, custom domain or not).
router.get('/t/:team', (req, res) => {
  const team = findTeam(req.params.team);
  if (!team) return res.status(404).send('Company not found');
  renderTeamHome(team, false, req, res);
});

router.get('/t/:team/posts/:slug', (req, res) => {
  const team = findTeam(req.params.team);
  if (!team) return res.status(404).send('Company not found');
  renderTeamPost(team, false, req.params.slug, res);
});

router.get('/t/:team/:slug', (req, res) => {
  const team = findTeam(req.params.team);
  if (!team) return res.status(404).send('Company not found');
  renderTeamPage(team, false, req.params.slug, res);
});

// Custom-domain pages at the domain root: /about, /pricing, …
router.get('/:slug', (req, res, next) => {
  if (!req.domainTeam) return next();
  renderTeamPage(req.domainTeam, true, req.params.slug, res);
});

module.exports = router;
