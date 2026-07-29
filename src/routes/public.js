const express = require('express');
const { marked } = require('marked');

const { getDb } = require('../db');

const router = express.Router();

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

function layout({ title, siteTitle, siteDescription, homeHref, nav = '', content }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title ? `${title} — ${siteTitle}` : siteTitle)}</title>
<style>
  :root { --fg: #1a1a1a; --muted: #666; --accent: #2563eb; --bg: #fff; --border: #e5e5e5; }
  @media (prefers-color-scheme: dark) {
    :root { --fg: #e5e5e5; --muted: #999; --accent: #60a5fa; --bg: #111; --border: #333; }
  }
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

function teamNav(team) {
  const pages = getDb()
    .prepare(
      "SELECT title, slug FROM content WHERE team_id = ? AND type = 'page' AND status = 'published' ORDER BY title"
    )
    .all(team.id);
  return pages.map((p) => `<a href="/t/${esc(team.slug)}/${esc(p.slug)}">${esc(p.title)}</a>`).join('');
}

function renderArticle(team, row, { full }) {
  const tags = getDb()
    .prepare(
      'SELECT t.name, t.slug FROM tags t JOIN content_tags ct ON ct.tag_id = t.id WHERE ct.content_id = ?'
    )
    .all(row.id);
  const date = (row.published_at || row.created_at || '').slice(0, 10);
  const tagHtml = tags
    .map((t) => `<a class="tag" href="/t/${esc(team.slug)}?tag=${esc(t.slug)}">${esc(t.name)}</a>`)
    .join('');
  const heading = full
    ? `<h1>${esc(row.title)}</h1>`
    : `<h2><a href="/t/${esc(team.slug)}/posts/${esc(row.slug)}">${esc(row.title)}</a></h2>`;
  const body = full
    ? marked.parse(row.body)
    : `<p>${esc(row.excerpt || row.body.replace(/[#*_`>\[\]]/g, '').slice(0, 200))}</p>`;
  const meta = row.type === 'post' ? `<div class="meta">${esc(date)} ${tagHtml}</div>` : '';
  return `<article>${heading}${meta}${body}</article>`;
}

function teamLayout(team, { title, content }) {
  const s = teamSettings(team.id);
  return layout({
    title,
    siteTitle: s.site_title || team.name,
    siteDescription: s.site_description || '',
    homeHref: `/t/${team.slug}`,
    nav: teamNav(team) + '<a href="/">All teams</a>',
    content,
  });
}

function findTeam(slug) {
  return getDb().prepare('SELECT * FROM teams WHERE slug = ?').get(slug);
}

// Platform home: directory of team sites.
router.get('/', (req, res) => {
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
    })
  );
});

// Team home: published posts, optionally filtered by ?tag=
router.get('/t/:team', (req, res) => {
  const team = findTeam(req.params.team);
  if (!team) return res.status(404).send('Team not found');
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
  const content = posts.length
    ? posts.map((p) => renderArticle(team, p, { full: false })).join('')
    : '<p>No posts yet.</p>';
  res.send(teamLayout(team, { title: tag ? `Tag: ${tag}` : '', content }));
});

router.get('/t/:team/posts/:slug', (req, res) => {
  const team = findTeam(req.params.team);
  if (!team) return res.status(404).send('Team not found');
  const row = getDb()
    .prepare("SELECT * FROM content WHERE team_id = ? AND type = 'post' AND status = 'published' AND slug = ?")
    .get(team.id, req.params.slug);
  if (!row) {
    return res.status(404).send(teamLayout(team, { title: 'Not found', content: '<h1>404</h1><p>Post not found.</p>' }));
  }
  res.send(teamLayout(team, { title: row.title, content: renderArticle(team, row, { full: true }) }));
});

// Team pages live at the team root: /t/acme/about
router.get('/t/:team/:slug', (req, res) => {
  const team = findTeam(req.params.team);
  if (!team) return res.status(404).send('Team not found');
  const row = getDb()
    .prepare("SELECT * FROM content WHERE team_id = ? AND type = 'page' AND status = 'published' AND slug = ?")
    .get(team.id, req.params.slug);
  if (!row) {
    return res.status(404).send(teamLayout(team, { title: 'Not found', content: '<h1>404</h1><p>Page not found.</p>' }));
  }
  res.send(teamLayout(team, { title: row.title, content: renderArticle(team, row, { full: true }) }));
});

module.exports = router;
