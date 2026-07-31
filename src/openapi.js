/** OpenAPI 3.1 description of the Nova CMS API, served at
    /api/openapi.json and rendered as a reference at /api/docs.
    Authored as data (not annotations) so it stays honest and greppable. */

const { version } = require('../package.json');

// Terse path helper: op('get', 'Tag', 'Summary', {opts})
function op(method, tag, summary, extra = {}) {
  return { [method]: { tags: [tag], summary, ...extra } };
}

const idParam = (name, where = 'path') => ({
  name,
  in: where,
  required: where === 'path',
  schema: { type: where === 'path' ? 'integer' : 'string' },
});

const SCHEMAS = {
  Content: {
    type: 'object',
    properties: {
      id: { type: 'integer' },
      team_id: { type: 'integer' },
      type: { type: 'string', description: "'post', 'page', or a custom type key" },
      title: { type: 'string' },
      slug: { type: 'string' },
      body: { type: 'string' },
      format: { type: 'string', enum: ['markdown', 'text', 'html', 'image', 'embed', 'blocks'] },
      excerpt: { type: 'string' },
      cover_image: { type: 'string' },
      status: { type: 'string', enum: ['draft', 'pending', 'published'] },
      locale: { type: 'string' },
      translation_of: { type: ['integer', 'null'] },
      fields: { type: 'object', description: 'Custom-type field values' },
      references: { type: 'object', description: 'Expanded reference fields (single GET only)' },
      ai_review: { type: ['object', 'null'], description: 'AI pre-review while pending' },
      live_version: { type: ['object', 'null'], description: 'Still-live snapshot while edits await review' },
      tags: { type: 'array', items: { type: 'object' } },
      publish_at: { type: ['string', 'null'] },
      expire_at: { type: ['string', 'null'] },
      published_at: { type: ['string', 'null'] },
    },
  },
  ContentInput: {
    type: 'object',
    required: ['title'],
    properties: {
      type: { type: 'string', default: 'post' },
      title: { type: 'string' },
      slug: { type: 'string' },
      body: { type: 'string' },
      format: { type: 'string', enum: ['markdown', 'text', 'html', 'image', 'embed', 'blocks'] },
      excerpt: { type: 'string' },
      cover_image: { type: 'string' },
      status: { type: 'string', enum: ['draft', 'pending', 'published'] },
      tags: { type: 'array', items: { type: 'string' } },
      fields: { type: 'object' },
      locale: { type: 'string' },
      translation_of: { type: 'integer' },
      publish_at: { type: 'string', description: 'YYYY-MM-DD HH:MM (UTC)' },
      expire_at: { type: 'string' },
    },
  },
  Team: {
    type: 'object',
    properties: {
      id: { type: 'integer' },
      name: { type: 'string' },
      slug: { type: 'string' },
      custom_domain: { type: ['string', 'null'] },
      my_role: { type: 'string', enum: ['admin', 'manager'] },
      member_count: { type: 'integer' },
      content_count: { type: 'integer' },
    },
  },
  ContentType: {
    type: 'object',
    properties: {
      id: { type: 'integer' },
      key: { type: 'string' },
      name: { type: 'string' },
      name_plural: { type: 'string' },
      schema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            label: { type: 'string' },
            kind: { type: 'string', enum: ['text', 'longtext', 'number', 'date', 'url', 'select', 'reference'] },
            options: { type: 'array', items: { type: 'string' } },
            ref_type: { type: 'string' },
          },
        },
      },
    },
  },
  Error: { type: 'object', properties: { error: { type: 'string' } } },
};

function buildSpec(baseUrl = '') {
  const json = (schema) => ({ content: { 'application/json': { schema } } });
  const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
  const list = (name) => ({ type: 'array', items: ref(name) });
  const body = (schema) => ({ requestBody: { required: true, ...json(schema) } });
  const ok = (schema) => ({ responses: { 200: { description: 'OK', ...json(schema) } } });
  const teamPath = { parameters: [idParam('teamId')] };
  const itemPath = { parameters: [idParam('teamId'), idParam('cid')] };

  return {
    openapi: '3.1.0',
    info: {
      title: 'Nova CMS API',
      version,
      description:
        'The complete API behind Nova CMS — hosted sites, headless delivery, and the admin. ' +
        'Authenticate with a session cookie (login) or a company API key (`Authorization: Bearer nova_…`). ' +
        'Read keys allow GETs including drafts; write keys act as a manager, so their writes go through the approval workflow.',
    },
    servers: [{ url: baseUrl || '/' }],
    components: {
      securitySchemes: {
        cookie: { type: 'apiKey', in: 'cookie', name: 'cms_token', description: 'Session cookie set by /api/auth/login' },
        apiKey: { type: 'http', scheme: 'bearer', description: 'Company API key (nova_…)' },
      },
      schemas: SCHEMAS,
    },
    security: [{ cookie: [] }, { apiKey: [] }],
    tags: [
      { name: 'Auth', description: 'Sessions, registration, 2FA, notifications' },
      { name: 'Companies', description: 'Workspaces, members, settings, calendar' },
      { name: 'Content', description: 'CRUD, workflow, versions, translations, sharing' },
      { name: 'Content types', description: 'Custom types with field schemas' },
      { name: 'Media', description: 'Uploads with automatic WebP variants' },
      { name: 'Forms', description: 'Contact-form inbox' },
      { name: 'Integrations', description: 'Webhooks, API keys, import/export, AI' },
      { name: 'Public', description: 'No auth: the headless content API and form submission' },
      { name: 'Platform', description: 'Superadmin: stats, users, settings, backup' },
      { name: 'Ops', description: 'Health, metrics, TLS check' },
    ],
    paths: {
      '/api/auth/register': op('post', 'Auth', 'Create an account', { security: [] }),
      '/api/auth/login': op('post', 'Auth', 'Sign in (returns twofa_required when 2FA is on)', { security: [] }),
      '/api/auth/logout': op('post', 'Auth', 'Sign out'),
      '/api/auth/me': op('get', 'Auth', 'Current user (incl. totp_enabled)'),
      '/api/auth/password': op('post', 'Auth', 'Change own password'),
      '/api/auth/2fa/setup': op('post', 'Auth', 'Mint a TOTP secret (pending until verified)'),
      '/api/auth/2fa/verify': op('post', 'Auth', 'Enable 2FA with a working code'),
      '/api/auth/2fa/disable': op('post', 'Auth', 'Disable 2FA (current code required)'),
      '/api/auth/notifications': op('get', 'Auth', 'My notifications + unread count'),
      '/api/auth/notifications/read': op('post', 'Auth', 'Mark all notifications read'),

      '/api/teams': {
        ...op('get', 'Companies', 'My companies', ok(list('Team'))),
        ...op('post', 'Companies', 'Create a company (creator becomes its admin)'),
      },
      '/api/teams/{teamId}': {
        ...teamPath,
        ...op('get', 'Companies', 'Company profile', ok(ref('Team'))),
        ...op('put', 'Companies', 'Update name, slug, custom domain (admin)'),
        ...op('delete', 'Companies', 'Delete the company (admin)'),
      },
      '/api/teams/{teamId}/stats': { ...teamPath, ...op('get', 'Companies', 'Dashboard KPIs, recent content, content radar') },
      '/api/teams/{teamId}/members': { ...teamPath, ...op('get', 'Companies', 'List members'), ...op('post', 'Companies', 'Add a member by username (admin)') },
      '/api/teams/{teamId}/settings': { ...teamPath, ...op('get', 'Companies', 'Site settings'), ...op('put', 'Companies', 'Update site settings (admin): theme, fonts, layout, nav_links…') },
      '/api/teams/{teamId}/calendar.ics': { ...teamPath, ...op('get', 'Companies', 'Editorial calendar as an ICS feed (member session or ?key=API key)', { security: [] }) },
      '/api/teams/{teamId}/audit': { ...teamPath, ...op('get', 'Companies', 'Audit log (admin)') },

      '/api/teams/{teamId}/content': {
        ...teamPath,
        ...op('get', 'Content', 'List content (?type=&status=&tag=&search=&locale=)', ok(list('Content'))),
        ...op('post', 'Content', 'Create content (managers cannot set published)', { ...body(ref('ContentInput')), responses: { 201: { description: 'Created', ...json(ref('Content')) } } }),
      },
      '/api/teams/{teamId}/content/trash': { ...teamPath, ...op('get', 'Content', 'List trashed items') },
      '/api/teams/{teamId}/content/{cid}': {
        ...itemPath,
        ...op('get', 'Content', 'One item with body_html, references, translations', ok(ref('Content'))),
        ...op('put', 'Content', 'Update (manager edits to live content go back through review)', body(ref('ContentInput'))),
        ...op('delete', 'Content', 'Move to trash; DELETE again purges (admin)'),
      },
      '/api/teams/{teamId}/content/{cid}/approve': { ...itemPath, ...op('post', 'Content', 'Approve pending content (admin) — goes live') },
      '/api/teams/{teamId}/content/{cid}/reject': { ...itemPath, ...op('post', 'Content', 'Reject pending content back to draft with a note (admin)') },
      '/api/teams/{teamId}/content/{cid}/untrash': { ...itemPath, ...op('post', 'Content', 'Restore from the trash') },
      '/api/teams/{teamId}/content/{cid}/duplicate': { ...itemPath, ...op('post', 'Content', 'Duplicate as a fresh draft') },
      '/api/teams/{teamId}/content/{cid}/share-link': { ...itemPath, ...op('post', 'Content', 'Mint a signed, expiring public preview link') },
      '/api/teams/{teamId}/content/{cid}/ai-translate': { ...itemPath, ...op('post', 'Content', 'AI-translate into a linked draft ({locale})') },
      '/api/teams/{teamId}/content/{cid}/versions': { ...itemPath, ...op('get', 'Content', 'Version history') },
      '/api/teams/{teamId}/content/{cid}/comments': { ...itemPath, ...op('get', 'Content', 'Discussion thread'), ...op('post', 'Content', 'Add a comment') },

      '/api/teams/{teamId}/content-types': { ...teamPath, ...op('get', 'Content types', 'List custom types', ok(list('ContentType'))), ...op('post', 'Content types', 'Define a type with a field schema (admin)') },
      '/api/teams/{teamId}/content-types/{ctid}': { parameters: [idParam('teamId'), idParam('ctid')], ...op('put', 'Content types', 'Update a type (admin)'), ...op('delete', 'Content types', 'Delete an unused type (admin)') },

      '/api/teams/{teamId}/media': { ...teamPath, ...op('get', 'Media', 'List media with WebP variant URLs'), ...op('post', 'Media', 'Upload (multipart "file") — @md/@sm variants generated') },
      '/api/teams/{teamId}/forms': { ...teamPath, ...op('get', 'Forms', 'Contact-form inbox (admin)') },
      '/api/teams/{teamId}/webhooks': { ...teamPath, ...op('get', 'Integrations', 'List webhooks (admin)'), ...op('post', 'Integrations', 'Add a signed webhook (admin) — secret shown once') },
      '/api/teams/{teamId}/api-keys': { ...teamPath, ...op('get', 'Integrations', 'List API keys (admin)'), ...op('post', 'Integrations', 'Create a read/write key (admin) — token shown once') },
      '/api/teams/{teamId}/import': { ...teamPath, ...op('post', 'Integrations', 'Import WordPress WXR (.xml), Markdown (.md), or a Nova export (.json) — multipart "files" (admin)') },
      '/api/teams/{teamId}/export': { ...teamPath, ...op('get', 'Integrations', 'Full company JSON export (admin)') },
      '/api/teams/{teamId}/apply-template': { ...teamPath, ...op('post', 'Integrations', 'Apply a starter kit ({template}) (admin)') },
      '/api/teams/{teamId}/ai-build': { ...teamPath, ...op('post', 'Integrations', 'AI site builder ({prompt}) (admin)') },
      '/api/site-templates': op('get', 'Integrations', 'Starter-kit catalog + AI availability'),

      '/api/public/{company}': { parameters: [idParam('company')], ...op('get', 'Public', 'Public company profile', { security: [] }) },
      '/api/public/{company}/content': { parameters: [idParam('company')], ...op('get', 'Public', 'Published content list (?type=&tag=&locale=&q=)', { security: [] }) },
      '/api/public/{company}/content/{slug}': { parameters: [idParam('company'), idParam('slug')], ...op('get', 'Public', 'One published item with body_html, references, translations', { security: [] }) },
      '/api/public/{company}/forms': { parameters: [idParam('company')], ...op('post', 'Public', 'Submit a contact form (rate-limited, honeypot)', { security: [] }) },

      '/api/platform/stats': op('get', 'Platform', 'Platform-wide KPIs (superadmin)'),
      '/api/platform/backup': op('get', 'Platform', 'Point-in-time SQLite snapshot download (superadmin)'),
      '/api/users': op('get', 'Platform', 'User administration (superadmin)'),
      '/api/settings': op('get', 'Platform', 'Platform settings (public read; superadmin write)'),

      '/api/health': op('get', 'Ops', 'Liveness + version', { security: [] }),
      '/api/metrics': op('get', 'Ops', 'Prometheus metrics (superadmin or METRICS_TOKEN bearer)'),
      '/api/tls-check': op('get', 'Ops', 'Caddy on-demand TLS gate (?domain=)', { security: [] }),
    },
  };
}

module.exports = { buildSpec };
