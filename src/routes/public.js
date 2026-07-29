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

function settings() {
  const rows = getDb().prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

function layout({ title, content }) {
  const s = settings();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title ? `${title} — ${s.site_title}` : s.site_title)}</title>
<style>
  :root { --fg: #1a1a1a; --muted: #666; --accent: #2563eb; --bg: #fff; --border: #e5e5e5; }
  @media (prefers-color-scheme: dark) {
    :root { --fg: #e5e5e5; --muted: #999; --accent: #60a5fa; --bg: #111; --border: #333; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, sans-serif; color: var(--fg); background: var(--bg); line-height: 1.6; }
  header { border-bottom: 1px solid var(--border); }
  .wrap { max-width: 720px; margin: 0 auto; padding: 1rem 1.25rem; }
  header .wrap { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; }
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
</style>
</head>
<body>
<header><div class="wrap">
  <h1 class="site"><a href="/">${esc(s.site_title)}</a></h1>
  <nav>${pageLinks()}</nav>
</div></header>
<main class="wrap">${content}</main>
<footer><div class="wrap">${esc(s.site_description)}</div></footer>
</body>
</html>`;
}

function pageLinks() {
  const pages = getDb()
    .prepare("SELECT title, slug FROM content WHERE type = 'page' AND status = 'published' ORDER BY title")
    .all();
  return pages.map((p) => `<a href="/${esc(p.slug)}">${esc(p.title)}</a>`).join('');
}

function renderArticle(row, { full }) {
  const tags = getDb()
    .prepare(
      `SELECT t.name, t.slug FROM tags t JOIN content_tags ct ON ct.tag_id = t.id WHERE ct.content_id = ?`
    )
    .all(row.id);
  const date = (row.published_at || row.created_at || '').slice(0, 10);
  const tagHtml = tags
    .map((t) => `<a class="tag" href="/?tag=${esc(t.slug)}">${esc(t.name)}</a>`)
    .join('');
  const heading = full
    ? `<h1>${esc(row.title)}</h1>`
    : `<h2><a href="/posts/${esc(row.slug)}">${esc(row.title)}</a></h2>`;
  const body = full
    ? marked.parse(row.body)
    : `<p>${esc(row.excerpt || row.body.replace(/[#*_`>\[\]]/g, '').slice(0, 200))}</p>`;
  const meta = row.type === 'post' ? `<div class="meta">${esc(date)} ${tagHtml}</div>` : '';
  return `<article>${heading}${meta}${body}</article>`;
}

// Home: list of published posts, optionally filtered by ?tag=
router.get('/', (req, res) => {
  const { tag } = req.query;
  const params = [];
  let filter = '';
  if (tag) {
    filter =
      'AND id IN (SELECT ct.content_id FROM content_tags ct JOIN tags t ON t.id = ct.tag_id WHERE t.slug = ?)';
    params.push(tag);
  }
  const posts = getDb()
    .prepare(
      `SELECT * FROM content WHERE type = 'post' AND status = 'published' ${filter}
       ORDER BY published_at DESC`
    )
    .all(...params);
  const content = posts.length
    ? posts.map((p) => renderArticle(p, { full: false })).join('')
    : '<p>No posts yet.</p>';
  res.send(layout({ title: tag ? `Tag: ${tag}` : '', content }));
});

router.get('/posts/:slug', (req, res) => {
  const row = getDb()
    .prepare("SELECT * FROM content WHERE type = 'post' AND status = 'published' AND slug = ?")
    .get(req.params.slug);
  if (!row) return res.status(404).send(layout({ title: 'Not found', content: '<h1>404</h1><p>Post not found.</p>' }));
  res.send(layout({ title: row.title, content: renderArticle(row, { full: true }) }));
});

// Pages live at the root: /about, /contact, …
router.get('/:slug', (req, res) => {
  const row = getDb()
    .prepare("SELECT * FROM content WHERE type = 'page' AND status = 'published' AND slug = ?")
    .get(req.params.slug);
  if (!row) return res.status(404).send(layout({ title: 'Not found', content: '<h1>404</h1><p>Page not found.</p>' }));
  res.send(layout({ title: row.title, content: renderArticle(row, { full: true }) }));
});

module.exports = router;
