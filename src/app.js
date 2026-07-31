const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const { init, getDb } = require('./db');
const { attachUser, requireAuth } = require('./auth');
const { metricsMiddleware, renderPrometheus, reportError } = require('./observability');
const { buildSpec } = require('./openapi');
const { templateSummaries } = require('./templates');
const { aiAvailable } = require('./ai');
const { securityHeaders } = require('./security');
const { version } = require('../package.json');
const authRoutes = require('./routes/auth');
const teamRoutes = require('./routes/teams');
const userRoutes = require('./routes/users');
const settingsRoutes = require('./routes/settings');
const platformRoutes = require('./routes/platform');
const publicRoutes = require('./routes/public');

function createApp(options = {}) {
  init(options.db || {});

  const app = express();
  // Behind a reverse proxy (nginx/Caddy/load balancer), trust X-Forwarded-*
  // so req.ip and req.protocol are correct for rate limiting and links.
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);

  // Structured request logs (one JSON line per request) for log shippers.
  if (process.env.NOVA_LOG === 'json') {
    app.use((req, res, next) => {
      const started = Date.now();
      res.on('finish', () => {
        console.log(
          JSON.stringify({
            time: new Date().toISOString(),
            method: req.method,
            path: req.originalUrl,
            status: res.statusCode,
            ms: Date.now() - started,
            ip: req.ip,
          })
        );
      });
      next();
    });
  }

  app.use(metricsMiddleware);
  app.use(securityHeaders);
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  app.use(attachUser);

  // For load balancers and uptime monitors.
  app.get('/api/health', (req, res) => res.json({ ok: true, version }));

  // Prometheus metrics — superadmin session, or Bearer METRICS_TOKEN for scrapers.
  app.get('/api/metrics', (req, res) => {
    const token = process.env.METRICS_TOKEN;
    const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const allowed = (req.user && req.user.role === 'superadmin') || (token && bearer === token);
    if (!allowed) return res.status(401).json({ error: 'Superadmin or metrics token required' });
    res.type('text/plain; version=0.0.4').send(renderPrometheus());
  });

  // Caddy on-demand TLS "ask" endpoint: 200 only for hostnames this
  // platform actually serves (its own domain + connected custom domains),
  // so certificates can never be minted for arbitrary names.
  app.get('/api/tls-check', (req, res) => {
    const domain = String(req.query.domain || '').trim().toLowerCase();
    if (!domain) return res.status(400).send('domain required');
    const platform = String(process.env.PLATFORM_DOMAIN || '').toLowerCase();
    const known =
      (platform && domain === platform) ||
      Boolean(getDb().prepare('SELECT 1 FROM teams WHERE custom_domain = ?').get(domain));
    res.status(known ? 200 : 404).send(known ? 'ok' : 'unknown domain');
  });

  // The in-app Help page renders the repo tutorial — one source of truth.
  app.get('/api/help.md', (req, res) => {
    res.type('text/markdown; charset=utf-8');
    res.sendFile(path.join(__dirname, '..', 'TUTORIAL.md'));
  });

  // Machine-readable API description + a human-readable reference built
  // from it, plus the browser build of the official JS SDK.
  app.get('/api/openapi.json', (req, res) => res.json(buildSpec()));
  app.get('/api/docs', (req, res) => {
    const spec = buildSpec();
    const byTag = new Map(spec.tags.map((t) => [t.name, []]));
    for (const [route, methods] of Object.entries(spec.paths)) {
      for (const [method, def] of Object.entries(methods)) {
        if (method === 'parameters') continue;
        (byTag.get(def.tags[0]) || []).push({ method: method.toUpperCase(), route, summary: def.summary });
      }
    }
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Nova CMS API</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: system-ui, sans-serif; margin: 0; color: #1a1f2e; background: #f7f8fb; line-height: 1.55; }
  .wrap { max-width: 880px; margin: 0 auto; padding: 2.5rem 1.5rem 4rem; }
  h1 { letter-spacing: -0.02em; margin: 0 0 0.2rem; } .sub { color: #667; margin: 0 0 2rem; }
  h2 { margin: 2.2rem 0 0.2rem; font-size: 1.15rem; } .tagdesc { color: #667; font-size: 0.88rem; margin: 0 0 0.7rem; }
  .ep { display: flex; gap: 0.7rem; align-items: baseline; padding: 0.45rem 0.6rem; border-bottom: 1px solid #e7eaf2; font-size: 0.88rem; background: #fff; }
  .ep:first-of-type { border-radius: 10px 10px 0 0; }
  .m { font-weight: 700; font-size: 0.7rem; width: 52px; text-align: center; border-radius: 6px; padding: 0.15rem 0; flex: none; }
  .GET { background: #e0f2fe; color: #075985; } .POST { background: #dcfce7; color: #14532d; }
  .PUT { background: #fef3c7; color: #92400e; } .DELETE { background: #fee2e2; color: #991b1b; }
  code { font-size: 0.84rem; } .s { color: #667; margin-left: auto; text-align: right; }
  a { color: #4f46e5; }
</style></head><body><div class="wrap">
<h1>Nova CMS API</h1>
<p class="sub">v${esc(spec.info.version)} — <a href="/api/openapi.json">openapi.json</a> · JS SDK: <code>&lt;script src="/sdk/nova-sdk.js"&gt;</code> or copy <code>sdk/</code> from the repo</p>
<p style="font-size:0.9rem;background:#fff;border:1px solid #e7eaf2;border-radius:10px;padding:0.8rem 1rem">${esc(spec.info.description)}</p>
${spec.tags
  .map((t) => {
    const endpoints = byTag.get(t.name) || [];
    if (!endpoints.length) return '';
    return `<h2>${esc(t.name)}</h2><p class="tagdesc">${esc(t.description)}</p>${endpoints
      .map((e) => `<div class="ep"><span class="m ${e.method}">${e.method}</span><code>${esc(e.route)}</code><span class="s">${esc(e.summary)}</span></div>`)
      .join('')}`;
  })
  .join('')}
</div></body></html>`);
  });
  app.use('/sdk', express.static(path.join(__dirname, '..', 'sdk')));

  // Starter kits for new sites + whether the AI builder is configured.
  app.get('/api/site-templates', requireAuth, (req, res) =>
    res.json({ templates: templateSummaries(), ai_available: aiAvailable() })
  );

  // REST API — content, tags, and media are nested under their team:
  // /api/teams/:teamId/{content,tags,media,members,settings}
  app.use('/api/auth', authRoutes);
  app.use('/api/teams', teamRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/platform', platformRoutes);

  // Admin panel (static SPA) + shared assets (fonts)
  app.use('/admin', express.static(path.join(__dirname, '..', 'public', 'admin')));
  app.use('/assets', express.static(path.join(__dirname, '..', 'public', 'assets')));

  // Uploaded files
  app.use(
    '/uploads',
    express.static(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'))
  );

  // Public sites: / is the team directory, /t/:team is each team's site
  app.use('/', publicRoutes);

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    reportError(err, req);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
