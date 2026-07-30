const express = require('express');
const { marked } = require('marked');

const { getDb } = require('../db');
const { renderBody, fallbackExcerpt } = require('../render');

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

/** Inline markdown (bold, links, code…) for short fields like excerpts
    and site descriptions. */
function mdInline(text) {
  return marked.parseInline(String(text || ''));
}

/** Markdown stripped down to plain text — for meta descriptions. */
function plainText(text) {
  return String(text || '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*_`>~]/g, '')
    .trim();
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

function layout({ title, siteTitle, siteDescription, homeHref, nav = '', content, settings, meta = {} }) {
  const fullTitle = title ? `${title} — ${siteTitle}` : siteTitle;
  const description = plainText(meta.description || siteDescription || '');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:title" content="${esc(title || siteTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="${esc(meta.ogType || 'website')}">
${meta.ogImage ? `<meta property="og:image" content="${esc(meta.ogImage)}">` : ''}
${meta.feedHref ? `<link rel="alternate" type="application/rss+xml" title="${esc(siteTitle)}" href="${esc(meta.feedHref)}">` : ''}
${(meta.alternates || []).map((a) => `<link rel="alternate" hreflang="${esc(a.lang)}" href="${esc(a.href)}">`).join('\n')}
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
  figure.body-image { margin: 0; }
  figure.body-image img { width: 100%; border-radius: 12px; }
  figure.body-image figcaption { color: var(--muted); font-size: 0.85rem; margin-top: 0.5rem; text-align: center; }
  .embed-wrap { position: relative; aspect-ratio: 16 / 9; border-radius: 12px; overflow: hidden; background: var(--border); }
  .embed-wrap iframe { position: absolute; inset: 0; width: 100%; height: 100%; }
  footer { border-top: 1px solid var(--border); color: var(--muted); font-size: 0.875rem; }
</style>
</head>
<body>
<header class="top"><div class="wrap">
  <h1 class="site"><a href="${esc(homeHref)}">${esc(siteTitle)}</a></h1>
  <nav>${nav}</nav>
</div></header>
<main class="wrap">${content}</main>
<footer><div class="wrap">${mdInline(siteDescription)}</div></footer>
</body>
</html>`;
}

/** Base path for a company's links: '' on its custom domain, /t/<slug> otherwise. */
function teamBase(team, onDomain) {
  return onDomain ? '' : `/t/${team.slug}`;
}

function teamNav(team, base, onDomain, loc) {
  const pages = getDb()
    .prepare(`SELECT * FROM content WHERE team_id = ? AND type = 'page' AND locale = ? AND ${LIVE} ORDER BY title`)
    .all(team.id, loc)
    .map(liveRow);
  let links = pages.map((p) => `<a href="${esc(base)}/${esc(p.slug)}">${esc(p.title)}</a>`).join('');
  // Language switcher when the site publishes in several locales.
  const locales = liveLocales(team.id);
  if (locales.length > 1) {
    const def = defaultLocale(team.id);
    links += locales
      .map((l) => {
        const href = l === def ? base || '/' : `${base}/${l}`;
        return `<a href="${esc(href)}" ${l === loc ? 'style="color:var(--accent)"' : ''}>${esc(l.toUpperCase())}</a>`;
      })
      .join('');
  }
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
  const excerpt = row.excerpt ? mdInline(row.excerpt) : esc(fallbackExcerpt(row.format, row.body));
  return `<div class="card">
    <a href="${esc(href)}">${cover}</a>
    <div class="pad">
      <h2><a href="${esc(href)}">${esc(row.title)}</a></h2>
      <p>${excerpt}</p>
      <div class="meta">${esc(date)} ${tagLinks(row, base)}</div>
    </div>
  </div>`;
}

function fullArticle(team, row, base) {
  const date = (row.published_at || row.created_at || '').slice(0, 10);
  const cover = row.cover_image ? `<img class="cover-hero" src="${esc(row.cover_image)}" alt="">` : '';
  const meta = row.type === 'post' ? `<div class="meta">${esc(date)} ${tagLinks(row, base)}</div>` : '';
  return `<article class="full">${cover}<h1>${esc(row.title)}</h1>${meta}${renderBody(row.format, row.body, row.excerpt)}</article>`;
}

function teamLayout(team, onDomain, { title, content, meta = {}, locale }) {
  const s = teamSettings(team.id);
  const base = teamBase(team, onDomain);
  const loc = locale || s.default_locale || 'en';
  return layout({
    title,
    siteTitle: s.site_title || team.name,
    siteDescription: s.site_description || '',
    homeHref: base || '/',
    nav: teamNav(team, base, onDomain, loc),
    content,
    settings: s,
    meta: { feedHref: `${base}/feed.xml`, ...meta },
  });
}

function findTeam(slug) {
  return getDb().prepare('SELECT * FROM teams WHERE slug = ?').get(slug);
}

// A row is publicly visible when published, or when a previously approved
// version is still live while new edits await review (published_snapshot).
const LIVE = `((status = 'published'
  AND (publish_at IS NULL OR publish_at <= datetime('now'))
  AND (expire_at IS NULL OR expire_at > datetime('now'))) OR published_snapshot != '')`;

/** The version of a row the public should see. */
function liveRow(row) {
  if (!row || row.status === 'published' || !row.published_snapshot) return row;
  try {
    return { ...row, ...JSON.parse(row.published_snapshot) };
  } catch {
    return row;
  }
}

const LOCALE_RE = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/;

function defaultLocale(teamId) {
  return teamSettings(teamId).default_locale || 'en';
}

function liveLocales(teamId) {
  return getDb()
    .prepare(`SELECT DISTINCT locale FROM content WHERE team_id = ? AND ${LIVE} ORDER BY locale`)
    .all(teamId)
    .map((r) => r.locale);
}

/** Live translation-group siblings of a row (including itself). */
function liveAlternates(teamId, row) {
  const root = row.translation_of || row.id;
  return getDb()
    .prepare(
      `SELECT id, locale, slug, title, type FROM content
       WHERE team_id = ? AND (id = ? OR translation_of = ?) AND ${LIVE} ORDER BY locale`
    )
    .all(teamId, root, root, );
}

function renderTeamHome(team, onDomain, req, res, locale = null) {
  const s = teamSettings(team.id);
  const loc = locale || s.default_locale || 'en';
  const { tag } = req.query;
  const params = [team.id, loc];
  let filter = '';
  if (tag) {
    filter =
      'AND id IN (SELECT ct.content_id FROM content_tags ct JOIN tags t ON t.id = ct.tag_id WHERE t.team_id = ? AND t.slug = ?)';
    params.push(team.id, tag);
  }
  const posts = getDb()
    .prepare(
      `SELECT * FROM content WHERE team_id = ? AND type = 'post' AND locale = ? AND ${LIVE} ${filter}
       ORDER BY published_at DESC`
    )
    .all(...params)
    .map(liveRow);
  const base = teamBase(team, onDomain);
  const hero = `<div class="hero">
    <h1>${esc(s.site_title || team.name)}</h1>
    <p>${tag ? esc(`Tagged “${tag}”`) : mdInline(s.site_description || '')}</p>
    <div class="rule"></div>
  </div>`;
  const content = posts.length
    ? `${hero}<div class="cards">${posts.map((p) => postCard(team, p, base)).join('')}</div>`
    : `${hero}<p class="meta" style="margin-top:2rem">No posts yet.</p>`;
  res.send(teamLayout(team, onDomain, { title: tag ? `Tag: ${tag}` : '', content, locale: loc }));
}

function absoluteUrl(req, path) {
  return `${req.protocol}://${req.get('host')}${path}`;
}

function renderTeamPost(team, onDomain, slug, req, res) {
  const row = liveRow(
    getDb()
      .prepare(`SELECT * FROM content WHERE team_id = ? AND type = 'post' AND ${LIVE} AND slug = ?`)
      .get(team.id, slug)
  );
  if (!row) {
    return res
      .status(404)
      .send(teamLayout(team, onDomain, { title: 'Not found', content: '<div class="hero"><h1>404</h1><p>Post not found.</p></div>' }));
  }
  const base = teamBase(team, onDomain);
  const alternates = liveAlternates(team.id, row).map((a) => ({
    lang: a.locale,
    href: absoluteUrl(req, `${base}/posts/${a.slug}`),
  }));
  res.send(
    teamLayout(team, onDomain, {
      title: row.title,
      content: fullArticle(team, row, base),
      locale: row.locale,
      meta: {
        description: row.excerpt || undefined,
        ogType: 'article',
        ogImage: row.cover_image ? absoluteUrl(req, row.cover_image) : undefined,
        alternates: alternates.length > 1 ? alternates : [],
      },
    })
  );
}

function renderTeamPage(team, onDomain, slug, req, res) {
  const row = liveRow(
    getDb()
      .prepare(`SELECT * FROM content WHERE team_id = ? AND type = 'page' AND ${LIVE} AND slug = ?`)
      .get(team.id, slug)
  );
  if (!row) {
    return res
      .status(404)
      .send(teamLayout(team, onDomain, { title: 'Not found', content: '<div class="hero"><h1>404</h1><p>Page not found.</p></div>' }));
  }
  const base = teamBase(team, onDomain);
  const alternates = liveAlternates(team.id, row).map((a) => ({
    lang: a.locale,
    href: absoluteUrl(req, `${base}/${a.slug}`),
  }));
  res.send(
    teamLayout(team, onDomain, {
      title: row.title,
      content: fullArticle(team, row, base),
      locale: row.locale,
      meta: { description: row.excerpt || undefined, alternates: alternates.length > 1 ? alternates : [] },
    })
  );
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
    locale: row.locale,
    format: row.format,
    excerpt: row.excerpt,
    excerpt_html: mdInline(row.excerpt),
    cover_image: row.cover_image,
    tags,
    published_at: row.published_at,
    updated_at: row.updated_at,
  };
  if (withBody) {
    base.body = row.body;
    base.body_html = renderBody(row.format, row.body, row.excerpt);
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
  const { type, tag, locale } = req.query;
  const where = ['team_id = ?', LIVE];

  const params = [team.id];
  if (type) { where.push('type = ?'); params.push(type); }
  if (locale) { where.push('locale = ?'); params.push(String(locale).toLowerCase()); }
  if (tag) {
    where.push(
      'id IN (SELECT ct.content_id FROM content_tags ct JOIN tags t ON t.id = ct.tag_id WHERE t.team_id = ? AND t.slug = ?)'
    );
    params.push(team.id, tag);
  }
  const rows = getDb()
    .prepare(`SELECT * FROM content WHERE ${where.join(' AND ')} ORDER BY published_at DESC`)
    .all(...params)
    .map(liveRow);
  res.json(rows.map((r) => publicContentRow(r, { withBody: false })));
});

router.get('/api/public/:team/content/:slug', cors, (req, res) => {
  const team = findTeam(req.params.team);
  if (!team) return res.status(404).json({ error: 'Company not found' });
  const row = liveRow(
    getDb()
      .prepare(`SELECT * FROM content WHERE team_id = ? AND ${LIVE} AND slug = ?`)
      .get(team.id, req.params.slug)
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  const out = publicContentRow(row, { withBody: true });
  out.locale = row.locale;
  out.translations = liveAlternates(team.id, row)
    .filter((a) => a.id !== row.id)
    .map((a) => ({ locale: a.locale, slug: a.slug, title: a.title }));
  res.json(out);
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

// ---------- feeds, sitemaps, robots ----------

function livePosts(teamId) {
  return getDb()
    .prepare(`SELECT * FROM content WHERE team_id = ? AND type = 'post' AND ${LIVE} ORDER BY published_at DESC LIMIT 50`)
    .all(teamId)
    .map(liveRow);
}

function livePages(teamId) {
  return getDb()
    .prepare(`SELECT * FROM content WHERE team_id = ? AND type = 'page' AND ${LIVE} ORDER BY title`)
    .all(teamId)
    .map(liveRow);
}

function sendTeamFeed(team, onDomain, req, res) {
  const s = teamSettings(team.id);
  const origin = `${req.protocol}://${req.get('host')}`;
  const base = teamBase(team, onDomain);
  const loc = String(req.query.locale || s.default_locale || 'en').toLowerCase();
  const items = livePosts(team.id)
    .filter((p) => p.locale === loc)
    .map(
      (p) => `  <item>
    <title>${esc(p.title)}</title>
    <link>${esc(`${origin}${base}/posts/${p.slug}`)}</link>
    <guid isPermaLink="true">${esc(`${origin}${base}/posts/${p.slug}`)}</guid>
    <description>${esc(p.excerpt || '')}</description>
    <pubDate>${new Date((p.published_at || p.created_at).replace(' ', 'T') + 'Z').toUTCString()}</pubDate>
  </item>`
    )
    .join('\n');
  res.type('application/rss+xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>${esc(s.site_title || team.name)}</title>
  <link>${esc(`${origin}${base || '/'}`)}</link>
  <description>${esc(s.site_description || '')}</description>
${items}
</channel>
</rss>`);
}

function sendTeamSitemap(team, onDomain, req, res) {
  const origin = `${req.protocol}://${req.get('host')}`;
  const base = teamBase(team, onDomain);
  const def = defaultLocale(team.id);
  const urls = [
    `${origin}${base || '/'}`,
    ...liveLocales(team.id).filter((l) => l !== def).map((l) => `${origin}${base}/${l}`),
    ...livePages(team.id).map((p) => `${origin}${base}/${p.slug}`),
    ...livePosts(team.id).map((p) => `${origin}${base}/posts/${p.slug}`),
  ];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(u)}</loc></url>`).join('\n')}
</urlset>`);
}

router.get('/robots.txt', (req, res) => {
  const origin = `${req.protocol}://${req.get('host')}`;
  res.type('text/plain').send(`User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`);
});

// Domain-aware: a company's sitemap/feed at its root, platform sitemap otherwise.
router.get('/sitemap.xml', (req, res) => {
  if (req.domainTeam) return sendTeamSitemap(req.domainTeam, true, req, res);
  const origin = `${req.protocol}://${req.get('host')}`;
  const teams = getDb().prepare('SELECT slug FROM teams ORDER BY slug').all();
  const urls = [`${origin}/`, ...teams.map((t) => `${origin}/t/${t.slug}`)];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(u)}</loc></url>`).join('\n')}
</urlset>`);
});

router.get('/feed.xml', (req, res, next) => {
  if (!req.domainTeam) return next();
  sendTeamFeed(req.domainTeam, true, req, res);
});

router.get('/t/:team/feed.xml', (req, res) => {
  const team = findTeam(req.params.team);
  if (!team) return res.status(404).send('Company not found');
  sendTeamFeed(team, false, req, res);
});

router.get('/t/:team/sitemap.xml', (req, res) => {
  const team = findTeam(req.params.team);
  if (!team) return res.status(404).send('Company not found');
  sendTeamSitemap(team, false, req, res);
});

// ---------- HTML site ----------

// Root: a company's site home on its own domain, the directory otherwise.
router.get('/', (req, res) => {
  if (req.domainTeam) return renderTeamHome(req.domainTeam, true, req, res);

  const s = platformSettings();
  const teams = getDb()
    .prepare(
      `SELECT t.*, COUNT(c.id) AS published_count FROM teams t
       LEFT JOIN content c ON c.team_id = t.id AND (c.status = 'published' OR c.published_snapshot != '')
       GROUP BY t.id ORDER BY t.name`
    )
    .all();
  const content = `
    <div class="hero">
      <h1>${esc(s.site_title)}</h1>
      <p>${mdInline(s.site_description)}</p>
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
  renderTeamPost(req.domainTeam, true, req.params.slug, req, res);
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
  renderTeamPost(team, false, req.params.slug, req, res);
});

// Locale homes: /t/acme/es — guarded so ordinary page slugs fall through.
router.get('/t/:team/:loc', (req, res, next) => {
  const team = findTeam(req.params.team);
  if (!team) return res.status(404).send('Company not found');
  const code = req.params.loc.toLowerCase();
  if (!LOCALE_RE.test(code)) return next();
  const def = defaultLocale(team.id);
  if (code === def) return res.redirect(teamBase(team, false) || '/');
  if (!liveLocales(team.id).includes(code)) return next();
  renderTeamHome(team, false, req, res, code);
});

router.get('/t/:team/:slug', (req, res) => {
  const team = findTeam(req.params.team);
  if (!team) return res.status(404).send('Company not found');
  renderTeamPage(team, false, req.params.slug, req, res);
});

// Custom-domain locale homes: /es — guarded so page slugs fall through.
router.get('/:loc', (req, res, next) => {
  if (!req.domainTeam) return next();
  const code = req.params.loc.toLowerCase();
  if (!LOCALE_RE.test(code)) return next();
  const def = defaultLocale(req.domainTeam.id);
  if (code === def) return res.redirect('/');
  if (!liveLocales(req.domainTeam.id).includes(code)) return next();
  renderTeamHome(req.domainTeam, true, req, res, code);
});

// Custom-domain pages at the domain root: /about, /pricing, …
router.get('/:slug', (req, res, next) => {
  if (!req.domainTeam) return next();
  renderTeamPage(req.domainTeam, true, req.params.slug, req, res);
});

module.exports = router;
