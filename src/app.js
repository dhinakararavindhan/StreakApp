const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const { init } = require('./db');
const { attachUser } = require('./auth');
const authRoutes = require('./routes/auth');
const contentRoutes = require('./routes/content');
const tagRoutes = require('./routes/tags');
const mediaRoutes = require('./routes/media');
const userRoutes = require('./routes/users');
const settingsRoutes = require('./routes/settings');
const publicRoutes = require('./routes/public');

function createApp(options = {}) {
  init(options.db || {});

  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  app.use(attachUser);

  // REST API
  app.use('/api/auth', authRoutes);
  app.use('/api/content', contentRoutes);
  app.use('/api/tags', tagRoutes);
  app.use('/api/media', mediaRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/settings', settingsRoutes);

  // Admin panel (static SPA)
  app.use('/admin', express.static(path.join(__dirname, '..', 'public', 'admin')));

  // Uploaded files
  app.use(
    '/uploads',
    express.static(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'))
  );

  // Public site (must be last — catches slugs)
  app.use('/', publicRoutes);

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
