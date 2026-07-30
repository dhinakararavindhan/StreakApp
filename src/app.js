const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const { init } = require('./db');
const { attachUser } = require('./auth');
const authRoutes = require('./routes/auth');
const teamRoutes = require('./routes/teams');
const userRoutes = require('./routes/users');
const settingsRoutes = require('./routes/settings');
const platformRoutes = require('./routes/platform');
const publicRoutes = require('./routes/public');

function createApp(options = {}) {
  init(options.db || {});

  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  app.use(attachUser);

  // REST API — content, tags, and media are nested under their team:
  // /api/teams/:teamId/{content,tags,media,members,settings}
  app.use('/api/auth', authRoutes);
  app.use('/api/teams', teamRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/platform', platformRoutes);

  // Admin panel (static SPA)
  app.use('/admin', express.static(path.join(__dirname, '..', 'public', 'admin')));

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
