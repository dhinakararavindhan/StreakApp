/** Importers: bring existing content into a company from
      - WordPress WXR exports (.xml)
      - Markdown files with optional front matter (.md)
      - Nova's own JSON export (.json) — the no-lock-in round trip
    Importing is an admin action, so statuses are preserved: published
    items land published, everything else lands as a draft. */

const { getDb, slugify, uniqueSlug } = require('./db');
const { getType, normalizeSchema, validateFields, BUILTIN_TYPES } = require('./content-types');
const { FORMATS } = require('./render');

// ---------- shared insert ----------

/** Insert one normalized item: {type, title, slug?, body, format, excerpt,
    status, locale?, tags[], fields?, published_at?}. */
function insertItem(teamId, item, user) {
  const db = getDb();
  const type = item.type && (BUILTIN_TYPES.includes(item.type) || getType(teamId, item.type)) ? item.type : 'post';
  const status = item.status === 'published' ? 'published' : 'draft';
  const format = FORMATS.includes(item.format) ? item.format : 'markdown';
  const fieldCheck = validateFields(teamId, type, item.fields || {});
  const slug = uniqueSlug(item.slug || item.title, teamId);
  const publishedAt =
    status === 'published'
      ? (item.published_at && String(item.published_at).slice(0, 19).replace('T', ' ')) ||
        new Date().toISOString().slice(0, 19).replace('T', ' ')
      : null;
  const result = db
    .prepare(
      `INSERT INTO content (team_id, type, title, slug, body, format, excerpt, status, author_id, locale, fields, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      teamId, type, item.title, slug, item.body || '', format, item.excerpt || '', status,
      user ? user.id : null, item.locale || 'en', JSON.stringify(fieldCheck.values || {}), publishedAt
    );
  for (const raw of item.tags || []) {
    const name = String(raw).trim();
    if (!name) continue;
    const tagSlug = slugify(name);
    db.prepare('INSERT OR IGNORE INTO tags (team_id, name, slug) VALUES (?, ?, ?)').run(teamId, name, tagSlug);
    const tag = db.prepare('SELECT id FROM tags WHERE team_id = ? AND slug = ?').get(teamId, tagSlug);
    db.prepare('INSERT OR IGNORE INTO content_tags (content_id, tag_id) VALUES (?, ?)').run(result.lastInsertRowid, tag.id);
  }
  return result.lastInsertRowid;
}

// ---------- WordPress WXR ----------

function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Extract one XML element's text (CDATA or entity-encoded) from a block. */
function xmlTag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  if (!m) return '';
  const inner = m[1].trim();
  const cdata = inner.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  return cdata ? cdata[1] : decodeEntities(inner);
}

/** WordPress stores classic-editor content with bare newlines and adds
    <p> tags at render time — mirror that when no block markup is present. */
function wpAutop(html) {
  if (/<(p|div|h[1-6]|ul|ol|blockquote|figure|table|pre)[\s>]/i.test(html)) return html;
  return html
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${p.replace(/\n/g, '<br>\n')}</p>`)
    .join('\n');
}

/** Parse a WXR export into normalized items. */
function parseWxr(xml) {
  const items = [];
  const skipped = [];
  for (const m of String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const postType = xmlTag(block, 'wp:post_type') || 'post';
    if (!['post', 'page'].includes(postType)) {
      skipped.push(postType);
      continue;
    }
    const wpStatus = xmlTag(block, 'wp:status');
    const tags = [...block.matchAll(/<category[^>]*domain="(?:post_tag|category)"[^>]*>([\s\S]*?)<\/category>/g)]
      .map((c) => {
        const inner = c[1].trim();
        const cdata = inner.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
        return (cdata ? cdata[1] : decodeEntities(inner)).trim();
      })
      .filter((t) => t && t.toLowerCase() !== 'uncategorized');
    const body = xmlTag(block, 'content:encoded');
    items.push({
      type: postType,
      title: xmlTag(block, 'title') || 'Untitled',
      slug: decodeURIComponent(xmlTag(block, 'wp:post_name') || ''),
      body: wpAutop(body),
      format: 'html',
      excerpt: xmlTag(block, 'excerpt:encoded').replace(/<[^>]+>/g, '').trim(),
      status: wpStatus === 'publish' ? 'published' : 'draft',
      published_at: xmlTag(block, 'wp:post_date_gmt') || undefined,
      tags: [...new Set(tags)],
    });
  }
  return { items, skipped };
}

// ---------- Markdown with front matter ----------

/** Parse `key: value` front matter between --- fences; body follows. */
function parseMarkdown(text, filename = '') {
  const src = String(text).replace(/^﻿/, '');
  const meta = {};
  let body = src;
  const fm = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (fm) {
    body = src.slice(fm[0].length);
    for (const line of fm[1].split(/\r?\n/)) {
      const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
      if (kv) meta[kv[1].toLowerCase()] = kv[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  let title = meta.title;
  if (!title) {
    const h1 = body.match(/^#\s+(.+)$/m);
    if (h1) {
      title = h1[1].trim();
      body = body.replace(h1[0], '').trimStart();
    }
  }
  if (!title) title = filename.replace(/\.(md|markdown|txt)$/i, '').replace(/[-_]/g, ' ').trim() || 'Untitled';
  const tags = (meta.tags || '')
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  return {
    type: meta.type || 'post',
    title,
    slug: meta.slug || '',
    body: body.trim(),
    format: 'markdown',
    excerpt: meta.excerpt || meta.description || '',
    status: ['published', 'publish'].includes((meta.status || '').toLowerCase()) ? 'published' : 'draft',
    published_at: meta.date || undefined,
    locale: meta.locale || meta.lang || undefined,
    tags,
  };
}

// ---------- Nova JSON export ----------

const IMPORTABLE_SETTINGS = new Set([
  'site_title', 'site_description', 'theme', 'accent_color', 'custom_css', 'default_locale', 'heading_font', 'layout',
]);

/** Import a Nova export: custom types, settings, and content. */
function importNovaExport(teamId, data, user) {
  const db = getDb();
  let types = 0;
  for (const ct of data.content_types || []) {
    const key = slugify(String(ct.key || ct.name || ''));
    if (!key || BUILTIN_TYPES.includes(key) || getType(teamId, key)) continue;
    const normalized = normalizeSchema(ct.schema);
    if (normalized.error) continue;
    db.prepare('INSERT INTO content_types (team_id, key, name, name_plural, schema) VALUES (?, ?, ?, ?, ?)').run(
      teamId,
      key,
      String(ct.name || key).slice(0, 60),
      String(ct.name_plural || `${ct.name || key}s`).slice(0, 60),
      JSON.stringify(normalized.schema)
    );
    types++;
  }
  const put = db.prepare(
    `INSERT INTO team_settings (team_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(team_id, key) DO UPDATE SET value = excluded.value`
  );
  for (const [key, value] of Object.entries(data.settings || {})) {
    if (IMPORTABLE_SETTINGS.has(key)) put.run(teamId, key, String(value));
  }
  let imported = 0;
  for (const item of data.content || []) {
    if (!item || !item.title) continue;
    insertItem(
      teamId,
      {
        ...item,
        // Only 'published' survives as-is; pending/draft land as drafts.
        status: item.status === 'published' ? 'published' : 'draft',
        tags: item.tags || [],
      },
      user
    );
    imported++;
  }
  return { imported, types };
}

module.exports = { insertItem, parseWxr, parseMarkdown, importNovaExport, wpAutop };
