const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');

const { getDb } = require('../db');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads');
const ALLOWED_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  'application/pdf', 'text/plain',
]);

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(0, 10);
    cb(null, `${crypto.randomBytes(8).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_TYPES.has(file.mimetype)) {
      return cb(new Error('File type not allowed'));
    }
    cb(null, true);
  },
});

// Mounted at /api/teams/:teamId/media behind requireTeamRole('editor').
const router = express.Router({ mergeParams: true });

router.get('/', (req, res) => {
  const rows = getDb()
    .prepare('SELECT * FROM media WHERE team_id = ? ORDER BY created_at DESC')
    .all(req.team.id);
  res.json(rows.map((r) => ({ ...r, url: `/uploads/${r.filename}` })));
});

router.post('/', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'file is required' });
    const db = getDb();
    const result = db
      .prepare(
        'INSERT INTO media (team_id, filename, original_name, mime_type, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(req.team.id, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, req.user.id);
    const row = db.prepare('SELECT * FROM media WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ ...row, url: `/uploads/${row.filename}` });
  });
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM media WHERE id = ? AND team_id = ?').get(req.params.id, req.team.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM media WHERE id = ?').run(row.id);
  fs.rm(path.join(UPLOAD_DIR, row.filename), { force: true }, () => {});
  res.json({ ok: true });
});

module.exports = router;
