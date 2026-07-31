const express = require('express');
const { marked } = require('marked');

const { getDb } = require('../db');
const { renderBody, fallbackExcerpt } = require('../render');
const { getType, parseFieldValues, BUILTIN_TYPES } = require('../content-types');

const router = express.Router();

// CDN-friendly caching on every public GET: short browser cache, longer
// edge cache, stale-while-revalidate so traffic spikes never hit origin
// cold. Admin and authenticated APIs are mounted before this router.
router.use((req, res, next) => {
  if (req.method === 'GET') {
    res.set('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
  }
  next();
});

// Time machine: signed-in users can view any public page as it will look
// at a future (or past) moment — scheduled posts appear, expiring ones
// vanish. ?preview_at=YYYY-MM-DDTHH:MM anywhere on a site. Never cached.
router.use((req, res, next) => {
  previewNow = null; // reset the per-request slots
  draftPreview = false;
  const at = req.query.preview_at;
  if (at && req.user) {
    const m = String(at).trim().replace('T', ' ').match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2})(:\d{2})?$/);
    if (m) {
      previewNow = `${m[1]}${m[2] || ':00'}`;
      res.set('Cache-Control', 'private, no-store');
    }
  }
  next();
});

// Theme presets a company can pick for its site. 'default' follows the
// visitor's light/dark preference; the rest are fixed brand looks.
const THEMES = {
  default: null, // handled via prefers-color-scheme below
  paper: { bg: '#faf7f0', fg: '#292420', muted: '#8a7f70', border: '#e6ddcc', accent: '#b45309' },
  forest: { bg: '#f6faf7', fg: '#14281d', muted: '#5c6f60', border: '#d8e4da', accent: '#166534' },
  ocean: { bg: '#f4f8fb', fg: '#0f2537', muted: '#5b7387', border: '#d4e2ec', accent: '#0e7490' },
  mint: { bg: '#f1faf6', fg: '#11312a', muted: '#5c7a70', border: '#d5e9e0', accent: '#0d9488' },
  lavender: { bg: '#faf8ff', fg: '#26203a', muted: '#6f6a89', border: '#e7e1f6', accent: '#7c3aed' },
  midnight: { bg: '#0f1115', fg: '#e5e7eb', muted: '#98a2b3', border: '#2a2f3a', accent: '#60a5fa' },
  slate: { bg: '#1e293b', fg: '#e2e8f0', muted: '#94a3b8', border: '#334155', accent: '#38bdf8' },
  noir: { bg: '#000000', fg: '#f5f5f5', muted: '#9a9a9a', border: '#262626', accent: '#f43f5e' },
  sunset: { bg: '#1d1210', fg: '#f6e9e1', muted: '#b39a8d', border: '#3c2a23', accent: '#fb923c' },
  terminal: { bg: '#0a0f0a', fg: '#c9f5c9', muted: '#71a071', border: '#1e301e', accent: '#22c55e' },
};

// Heading typography options a company can pair with any theme.
const HEADING_FONTS = {
  sans: '',
  serif: "h1, h2, h3, h1.site, .card h2, .postrow h2 { font-family: Georgia, 'Times New Roman', serif; }",
  mono: "h1, h2, h3, h1.site, .card h2, .postrow h2 { font-family: ui-monospace, 'SF Mono', 'Cascadia Code', monospace; letter-spacing: -0.01em; }",
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
  ${HEADING_FONTS[settings.heading_font] || ''}
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
  .postlist { margin-top: 1.5rem; }
  a.postrow { display: flex; gap: 1.1rem; padding: 1.15rem 0; border-bottom: 1px solid var(--border); color: var(--fg); align-items: flex-start; }
  a.postrow:hover { text-decoration: none; }
  a.postrow:hover h2 { color: var(--accent); }
  .postrow h2 { margin: 0 0 0.25rem; font-size: 1.1rem; letter-spacing: -0.01em; }
  .postrow p { margin: 0 0 0.3rem; color: var(--muted); font-size: 0.92rem; }
  .postrow img.thumb { width: 112px; height: 76px; object-fit: cover; border-radius: 8px; flex: none; }
  figure.body-image { margin: 0; }
  figure.body-image img { width: 100%; border-radius: 12px; }
  figure.body-image figcaption { color: var(--muted); font-size: 0.85rem; margin-top: 0.5rem; text-align: center; }
  .embed-wrap { position: relative; aspect-ratio: 16 / 9; border-radius: 12px; overflow: hidden; background: var(--border); }
  .embed-wrap iframe { position: absolute; inset: 0; width: 100%; height: 100%; }
  .btn-block { display: inline-block; background: var(--accent); color: var(--bg); font-weight: 600; padding: 0.6rem 1.3rem; border-radius: 10px; }
  .btn-block:hover { text-decoration: none; filter: brightness(1.08); }
  .contact-form { display: flex; flex-direction: column; gap: 0.9rem; max-width: 480px; margin: 1.5rem 0; }
  .contact-form label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.9rem; color: var(--muted); }
  .contact-form input, .contact-form textarea { padding: 0.55rem 0.8rem; border-radius: 9px; border: 1px solid var(--border); background: color-mix(in srgb, var(--fg) 3%, var(--bg)); color: var(--fg); font: inherit; }
  .contact-form button { align-self: flex-start; padding: 0.6rem 1.3rem; border-radius: 10px; border: none; background: var(--accent); color: var(--bg); font: inherit; font-weight: 600; cursor: pointer; }
  .contact-form .hp { position: absolute; left: -9999px; height: 0; width: 0; opacity: 0; }
  .site-search { display: flex; gap: 0.6rem; margin-top: 1.5rem; }
  .site-search input { flex: 1; max-width: 420px; padding: 0.6rem 0.9rem; border-radius: 10px; border: 1px solid var(--border); background: color-mix(in srgb, var(--fg) 3%, var(--bg)); color: var(--fg); font: inherit; }
  .site-search button { padding: 0.6rem 1.1rem; border-radius: 10px; border: none; background: var(--accent); color: var(--bg); font: inherit; font-weight: 600; cursor: pointer; }
  dl.fields { display: grid; grid-template-columns: max-content 1fr; gap: 0.35rem 1.25rem; margin: 0 0 2rem; padding: 1rem 1.25rem; border: 1px solid var(--border); border-radius: 12px; background: color-mix(in srgb, var(--fg) 3%, var(--bg)); }
  dl.fields dt { color: var(--muted); font-size: 0.85rem; font-weight: 600; }
  dl.fields dd { margin: 0; font-size: 0.92rem; }
  footer { border-top: 1px solid var(--border); color: var(--muted); font-size: 0.875rem; }
</style>
</head>
<body>
${previewNow ? `<div style="background:#f59e0b;color:#1a1200;font-weight:600;font-size:0.85rem;text-align:center;padding:0.45rem 1rem">⏱ Time machine — previewing this site as it will appear at ${esc(previewNow)} UTC. Scheduled content is shown; expired content is hidden.</div>` : ''}
${draftPreview ? `<div style="background:#3b82f6;color:#fff;font-weight:600;font-size:0.85rem;text-align:center;padding:0.45rem 1rem">📝 Draft preview — this is the latest saved version, not what visitors see. Only signed-in team members can view this page.</div>` : ''}
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
  const s = teamSettings(team.id);
  let links;
  if (String(s.nav_links || '').trim()) {
    // Custom menu: one "Label | /url" per line, in order. Absolute URLs
    // pass through; site-relative paths get the team base prefixed.
    links = String(s.nav_links)
      .split('\n')
      .map((line) => {
        const [label, url] = line.split('|').map((part) => (part || '').trim());
        if (!label || !url) return '';
        const href = /^(https?:)?\/\//.test(url) ? url : `${base}${url.startsWith('/') ? url : `/${url}`}`;
        return `<a href="${esc(href)}">${esc(label)}</a>`;
      })
      .join('');
  } else {
    const pages = getDb()
      .prepare(`SELECT * FROM content WHERE team_id = ? AND type = 'page' AND locale = ? AND ${LIVE()} ORDER BY title`)
      .all(team.id, loc)
      .map(liveRow);
    links = pages.map((p) => `<a href="${esc(base)}/${esc(p.slug)}">${esc(p.title)}</a>`).join('');
    // Custom-type archives (Rooms, Properties, Classes…) with live items.
    links += liveTypes(team.id)
      .map((t) => `<a href="${esc(base)}/c/${esc(t.key)}">${esc(t.name_plural)}</a>`)
      .join('');
  }
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
  links += `<a href="${esc(base)}/search" title="Search">⌕</a>`;
  return onDomain ? links : links + '<a href="/">All sites</a>';
}

/** Custom content types that currently have live items. */
function liveTypes(teamId) {
  return getDb()
    .prepare(
      `SELECT ct.key, ct.name, ct.name_plural FROM content_types ct
       WHERE ct.team_id = ? AND EXISTS (
         SELECT 1 FROM content WHERE team_id = ct.team_id AND type = ct.key AND ${LIVE()}
       ) ORDER BY ct.name`
    )
    .all(teamId);
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

/** Compact row for the 'list' home layout. */
function postRow(team, row, base) {
  const date = (row.published_at || row.created_at || '').slice(0, 10);
  const href = `${base}/posts/${row.slug}`;
  const thumb = row.cover_image ? `<img class="thumb" src="${esc(row.cover_image)}" alt="">` : '';
  const excerpt = row.excerpt ? mdInline(row.excerpt) : esc(fallbackExcerpt(row.format, row.body));
  return `<a class="postrow" href="${esc(href)}">${thumb}<div>
    <h2>${esc(row.title)}</h2>
    <p>${excerpt}</p>
    <div class="meta">${esc(date)}</div>
  </div></a>`;
}

function fullArticle(team, row, base) {
  const date = (row.published_at || row.created_at || '').slice(0, 10);
  const cover = row.cover_image ? `<img class="cover-hero" src="${esc(row.cover_image)}" alt="">` : '';
  const meta = row.type === 'post' ? `<div class="meta">${esc(date)} ${tagLinks(row, base)}</div>` : '';
  return `<article class="full">${cover}<h1>${esc(row.title)}</h1>${meta}${customFieldsHtml(team, row, base)}${renderBody(row.format, row.body, row.excerpt, { formAction: `/api/public/${team.slug}/forms` })}</article>`;
}

/** Custom-type field values as a definition list above the body.
    Reference fields render as links to the referenced item — but only
    when that item is itself live. */
function customFieldsHtml(team, row, base = '') {
  if (BUILTIN_TYPES.includes(row.type)) return '';
  const ct = getType(team.id, row.type);
  if (!ct || !ct.schema.length) return '';
  const values = parseFieldValues(row.fields);
  const items = [];
  for (const f of ct.schema) {
    const v = values[f.key];
    if (v === undefined || v === '') continue;
    let rendered;
    if (f.kind === 'reference') {
      const ref = getDb()
        .prepare(`SELECT id, title, slug, type FROM content WHERE id = ? AND team_id = ? AND ${LIVE()}`)
        .get(v, team.id);
      if (!ref) continue; // unpublished references never leak
      const href = ref.type === 'post' ? `${base}/posts/${ref.slug}` : `${base}/${ref.slug}`;
      rendered = `<a href="${esc(href)}">${esc(ref.title)}</a>`;
    } else if (f.kind === 'url') {
      rendered = `<a href="${esc(String(v))}">${esc(String(v))}</a>`;
    } else {
      rendered = esc(String(v));
    }
    items.push(`<dt>${esc(f.label)}</dt><dd>${rendered}</dd>`);
  }
  return items.length ? `<dl class="fields">${items.join('')}</dl>` : '';
}

/** Live-only reference expansion for the headless API. */
function publicReferences(team, row) {
  const ct = getType(team.id, row.type);
  if (!ct) return undefined;
  const values = parseFieldValues(row.fields);
  const out = {};
  for (const f of ct.schema) {
    if (f.kind !== 'reference') continue;
    const id = values[f.key];
    if (!id) continue;
    const ref = getDb()
      .prepare(`SELECT id, title, slug, type FROM content WHERE id = ? AND team_id = ? AND ${LIVE()}`)
      .get(id, team.id);
    if (ref) out[f.key] = ref;
  }
  return Object.keys(out).length ? out : undefined;
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

// Time machine: while serving a ?preview_at request from a signed-in user,
// this holds the pretend "now" ('YYYY-MM-DD HH:MM:SS'). All public route
// handlers are fully synchronous, so a module-level slot per request is
// safe — it is reset at the start of every request by the middleware below.
let previewNow = null;
const NOW_SQL = () => (previewNow ? `datetime('${previewNow}')` : `datetime('now')`);

// Draft preview: true while a team member is viewing their own not-yet-live
// version of an item (?preview=draft). Same per-request slot pattern.
let draftPreview = false;

/** May this request preview unpublished content for this company? */
function memberCanPreview(req, teamId) {
  if (!req.user || !req.user.id) return false;
  if (req.user.role === 'superadmin') return true;
  return Boolean(
    getDb().prepare('SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?').get(teamId, req.user.id)
  );
}

// A row is publicly visible when published, or when a previously approved
// version is still live while new edits await review (published_snapshot).
const LIVE = () => `(deleted_at IS NULL AND ((status = 'published'
  AND (publish_at IS NULL OR publish_at <= ${NOW_SQL()})
  AND (expire_at IS NULL OR expire_at > ${NOW_SQL()})) OR published_snapshot != ''))`;

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
    .prepare(`SELECT DISTINCT locale FROM content WHERE team_id = ? AND ${LIVE()} ORDER BY locale`)
    .all(teamId)
    .map((r) => r.locale);
}

/** Live translation-group siblings of a row (including itself). */
function liveAlternates(teamId, row) {
  const root = row.translation_of || row.id;
  return getDb()
    .prepare(
      `SELECT id, locale, slug, title, type FROM content
       WHERE team_id = ? AND (id = ? OR translation_of = ?) AND ${LIVE()} ORDER BY locale`
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
      `SELECT * FROM content WHERE team_id = ? AND type = 'post' AND locale = ? AND ${LIVE()} ${filter}
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
  const listMode = s.layout === 'list';
  const content = posts.length
    ? `${hero}${
        listMode
          ? `<div class="postlist">${posts.map((p) => postRow(team, p, base)).join('')}</div>`
          : `<div class="cards">${posts.map((p) => postCard(team, p, base)).join('')}</div>`
      }`
    : `${hero}<p class="meta" style="margin-top:2rem">No posts yet.</p>`;
  res.send(teamLayout(team, onDomain, { title: tag ? `Tag: ${tag}` : '', content, locale: loc }));
}

function absoluteUrl(req, path) {
  return `${req.protocol}://${req.get('host')}${path}`;
}

function renderTeamPost(team, onDomain, slug, req, res) {
  // ?preview=draft: a team member checks their latest saved version — the
  // working row itself, not the live snapshot. Never cached, never public.
  let row = null;
  if (req.query.preview === 'draft' && memberCanPreview(req, team.id)) {
    row = getDb()
      .prepare("SELECT * FROM content WHERE team_id = ? AND type = 'post' AND deleted_at IS NULL AND slug = ?")
      .get(team.id, slug);
    if (row) {
      draftPreview = true;
      res.set('Cache-Control', 'private, no-store');
    }
  }
  if (!row) {
    row = liveRow(
      getDb()
        .prepare(`SELECT * FROM content WHERE team_id = ? AND type = 'post' AND ${LIVE()} AND slug = ?`)
        .get(team.id, slug)
    );
  }
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

/** Site search: /search?q= across all live content, every type. */
function renderTeamSearch(team, onDomain, req, res) {
  const q = String(req.query.q || '').trim().slice(0, 100);
  const base = teamBase(team, onDomain);
  let results = [];
  if (q) {
    const like = `%${q}%`;
    results = getDb()
      .prepare(
        `SELECT * FROM content WHERE team_id = ? AND ${LIVE()}
         AND (title LIKE ? OR excerpt LIKE ? OR body LIKE ?)
         ORDER BY published_at DESC LIMIT 50`
      )
      .all(team.id, like, like, like)
      .map(liveRow);
  }
  const href = (row) => (row.type === 'post' ? `${base}/posts/${row.slug}` : `${base}/${row.slug}`);
  const rowsHtml = results
    .map((row) => {
      const excerpt = row.excerpt ? mdInline(row.excerpt) : esc(fallbackExcerpt(row.format, row.body));
      return `<a class="postrow" href="${esc(href(row))}"><div>
        <h2>${esc(row.title)}</h2><p>${excerpt}</p>
        <div class="meta">${esc(row.type)}</div>
      </div></a>`;
    })
    .join('');
  const content = `
    <div class="hero"><h1>Search</h1><div class="rule"></div></div>
    <form method="get" action="${esc(`${base}/search`)}" class="site-search">
      <input type="search" name="q" value="${esc(q)}" placeholder="Search this site…" autofocus>
      <button type="submit">Search</button>
    </form>
    ${q
      ? results.length
        ? `<p class="meta" style="margin-top:1.5rem">${results.length} result${results.length === 1 ? '' : 's'} for “${esc(q)}”</p><div class="postlist">${rowsHtml}</div>`
        : `<p class="meta" style="margin-top:2rem">Nothing found for “${esc(q)}”.</p>`
      : ''}`;
  res.send(teamLayout(team, onDomain, { title: q ? `Search: ${q}` : 'Search', content }));
}

/** Archive page for a custom content type: /c/<key> lists its live items,
    with a line of field values under each excerpt. */
function renderTypeArchive(team, onDomain, typeKey, req, res) {
  const ct = getType(team.id, String(typeKey).toLowerCase());
  if (!ct) {
    return res
      .status(404)
      .send(teamLayout(team, onDomain, { title: 'Not found', content: '<div class="hero"><h1>404</h1><p>Nothing here.</p></div>' }));
  }
  const rows = getDb()
    .prepare(`SELECT * FROM content WHERE team_id = ? AND type = ? AND ${LIVE()} ORDER BY published_at DESC`)
    .all(team.id, ct.key)
    .map(liveRow);
  const base = teamBase(team, onDomain);
  const s = teamSettings(team.id);
  const fieldLine = (row) => {
    const values = parseFieldValues(row.fields);
    const shown = ct.schema
      .filter((f) => f.kind !== 'url' && f.kind !== 'reference' && values[f.key] !== undefined && values[f.key] !== '')
      .slice(0, 3)
      .map((f) => `${esc(f.label)}: <b>${esc(String(values[f.key]))}</b>`);
    return shown.length ? `<div class="meta">${shown.join(' · ')}</div>` : '';
  };
  const card = (row) => {
    const href = `${base}/${row.slug}`;
    const excerpt = row.excerpt ? mdInline(row.excerpt) : esc(fallbackExcerpt(row.format, row.body));
    const cover = row.cover_image
      ? `<img class="cover" src="${esc(row.cover_image)}" alt="">`
      : `<div class="cover placeholder">✶</div>`;
    return `<div class="card">
      <a href="${esc(href)}">${cover}</a>
      <div class="pad"><h2><a href="${esc(href)}">${esc(row.title)}</a></h2><p>${excerpt}</p>${fieldLine(row)}</div>
    </div>`;
  };
  const rowItem = (row) => {
    const href = `${base}/${row.slug}`;
    const excerpt = row.excerpt ? mdInline(row.excerpt) : esc(fallbackExcerpt(row.format, row.body));
    return `<a class="postrow" href="${esc(href)}"><div>
      <h2>${esc(row.title)}</h2><p>${excerpt}</p>${fieldLine(row)}
    </div></a>`;
  };
  const hero = `<div class="hero"><h1>${esc(ct.name_plural)}</h1><div class="rule"></div></div>`;
  const listMode = s.layout === 'list';
  const content = rows.length
    ? `${hero}${
        listMode
          ? `<div class="postlist">${rows.map(rowItem).join('')}</div>`
          : `<div class="cards">${rows.map(card).join('')}</div>`
      }`
    : `${hero}<p class="meta" style="margin-top:2rem">Nothing here yet.</p>`;
  res.send(teamLayout(team, onDomain, { title: ct.name_plural, content }));
}

function renderTeamPage(team, onDomain, slug, req, res) {
  // Pages and custom-type items both live at /<slug>; posts keep /posts/<slug>.
  let row = null;
  if (req.query.preview === 'draft' && memberCanPreview(req, team.id)) {
    row = getDb()
      .prepare("SELECT * FROM content WHERE team_id = ? AND type != 'post' AND deleted_at IS NULL AND slug = ?")
      .get(team.id, slug);
    if (row) {
      draftPreview = true;
      res.set('Cache-Control', 'private, no-store');
    }
  }
  if (!row) {
    row = liveRow(
      getDb()
        .prepare(`SELECT * FROM content WHERE team_id = ? AND type != 'post' AND ${LIVE()} AND slug = ?`)
        .get(team.id, slug)
    );
  }
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

function publicContentRow(row, { withBody, formAction }) {
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
    fields: parseFieldValues(row.fields),
    tags,
    published_at: row.published_at,
    updated_at: row.updated_at,
  };
  if (withBody) {
    base.body = row.body;
    base.body_html = renderBody(row.format, row.body, row.excerpt, { formAction });
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
  const { type, tag, locale, q } = req.query;
  const where = ['team_id = ?', LIVE()];

  const params = [team.id];
  if (type) { where.push('type = ?'); params.push(type); }
  if (q) {
    where.push('(title LIKE ? OR excerpt LIKE ? OR body LIKE ?)');
    const like = `%${String(q).slice(0, 100)}%`;
    params.push(like, like, like);
  }
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
      .prepare(`SELECT * FROM content WHERE team_id = ? AND ${LIVE()} AND slug = ?`)
      .get(team.id, req.params.slug)
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  const out = publicContentRow(row, { withBody: true, formAction: `/api/public/${team.slug}/forms` });
  out.references = publicReferences(team, row);
  out.locale = row.locale;
  out.translations = liveAlternates(team.id, row)
    .filter((a) => a.id !== row.id)
    .map((a) => ({ locale: a.locale, slug: a.slug, title: a.title }));
  res.json(out);
});

// ---------- contact-form submissions ----------

const { deliver } = require('../webhooks');
const { rateLimit } = require('../security');

const formLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 10, name: 'form submissions' });

router.post('/api/public/:team/forms', formLimiter, express.urlencoded({ extended: false }), express.json(), (req, res) => {
  const team = findTeam(req.params.team);
  if (!team) return res.status(404).json({ error: 'Company not found' });
  const { name, email, message, website } = req.body || {};
  // Honeypot: the hidden "website" field is invisible to humans. Bots that
  // fill it get a cheerful 200 and nothing is stored.
  if (String(website || '').trim() !== '') return res.status(200).json({ ok: true });
  const clean = {
    name: String(name || '').trim().slice(0, 120),
    email: String(email || '').trim().slice(0, 200),
    message: String(message || '').trim().slice(0, 5000),
  };
  if (!clean.name || !clean.message || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean.email)) {
    return res.status(400).json({ error: 'name, a valid email, and a message are required' });
  }
  getDb()
    .prepare('INSERT INTO form_submissions (team_id, name, email, message) VALUES (?, ?, ?, ?)')
    .run(team.id, clean.name, clean.email, clean.message);
  deliver(team.id, 'form.submission', { company: team.slug, ...clean, at: new Date().toISOString() });

  if ((req.headers.accept || '').includes('application/json')) return res.status(201).json({ ok: true });
  // Browser form posts get a small themed thank-you page.
  res
    .status(201)
    .send(
      teamLayout(team, false, {
        title: 'Message sent',
        content: `<div class="hero"><h1>Thank you!</h1><p>Your message is on its way — we'll get back to you soon.</p><div class="rule"></div></div>
        <p style="margin-top:1.5rem"><a href="/t/${esc(team.slug)}">← Back to the site</a></p>`,
      })
    );
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
    .prepare(`SELECT * FROM content WHERE team_id = ? AND type = 'post' AND ${LIVE()} ORDER BY published_at DESC LIMIT 50`)
    .all(teamId)
    .map(liveRow);
}

// Pages and custom-type items — everything served at /<slug>.
function livePages(teamId) {
  return getDb()
    .prepare(`SELECT * FROM content WHERE team_id = ? AND type != 'post' AND ${LIVE()} ORDER BY title`)
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

// Custom-type archives: /c/rooms lists a type's live items.
router.get('/c/:typeKey', (req, res, next) => {
  if (!req.domainTeam) return next();
  renderTypeArchive(req.domainTeam, true, req.params.typeKey, req, res);
});

// Shared preview links: /share/<signed token> shows one item's latest
// saved version to anyone holding the link — used to send drafts to
// clients and stakeholders without accounts. Expiring, tamper-proof,
// never cached, and never listed anywhere.
router.get('/share/:token', (req, res) => {
  const { verifyShareToken } = require('../auth');
  const claim = verifyShareToken(req.params.token);
  const row = claim
    ? getDb().prepare('SELECT * FROM content WHERE id = ? AND deleted_at IS NULL').get(claim.contentId)
    : null;
  if (!row) {
    return res.status(404).send('<h1 style="font-family:sans-serif">This preview link is invalid or has expired.</h1>');
  }
  const team = getDb().prepare('SELECT * FROM teams WHERE id = ?').get(row.team_id);
  res.set('Cache-Control', 'private, no-store');
  res.set('X-Robots-Tag', 'noindex');
  draftPreview = false;
  const until = new Date(claim.exp).toISOString().slice(0, 10);
  const banner = `<div style="background:#3b82f6;color:#fff;font-weight:600;font-size:0.85rem;text-align:center;padding:0.45rem 1rem">🔗 Shared preview — this may be an unpublished draft. Link expires ${esc(until)}.</div>`;
  const html = teamLayout(team, false, {
    title: row.title,
    content: fullArticle(team, row, teamBase(team, false)),
    locale: row.locale,
  }).replace('<header class="top">', `${banner}<header class="top">`);
  res.send(html);
});

// Site search on a custom domain.
router.get('/search', (req, res, next) => {
  if (!req.domainTeam) return next();
  renderTeamSearch(req.domainTeam, true, req, res);
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

router.get('/t/:team/c/:typeKey', (req, res) => {
  const team = findTeam(req.params.team);
  if (!team) return res.status(404).send('Company not found');
  renderTypeArchive(team, false, req.params.typeKey, req, res);
});

router.get('/t/:team/search', (req, res) => {
  const team = findTeam(req.params.team);
  if (!team) return res.status(404).send('Company not found');
  renderTeamSearch(team, false, req, res);
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
