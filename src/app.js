const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const { init } = require('./db');
const { attachUser, requireAuth } = require('./auth');
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

  app.use(securityHeaders);
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  app.use(attachUser);

  // For load balancers and uptime monitors.
  app.get('/api/health', (req, res) => res.json({ ok: true, version }));

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
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
