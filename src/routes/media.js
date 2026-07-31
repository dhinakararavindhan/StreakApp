const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');

const { getDb } = require('../db');
const { overLimit } = require('../plans');

// Image processing is best-effort: if sharp is unavailable on this
// platform, uploads still work — originals only, no variants.
let sharp = null;
try {
  sharp = require('sharp');
} catch {
  sharp = null;
}

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads');
const RESIZABLE = new Set(['image/jpeg', 'image/png', 'image/webp']);
const VARIANTS = [
  ['md', 1200], // article bodies, covers
  ['sm', 400], // thumbnails, admin grids
];

/** Variant URLs that exist on disk for a media row. */
function variantUrls(filename) {
  const stem = filename.replace(/\.[^.]+$/, '');
  const out = {};
  for (const [label] of VARIANTS) {
    const name = `${stem}@${label}.webp`;
    if (fs.existsSync(path.join(UPLOAD_DIR, name))) out[label] = `/uploads/${name}`;
  }
  return out;
}

/** Generate downscaled webp variants next to the original (async, best-effort). */
async function makeVariants(filename, mimeType) {
  if (!sharp || !RESIZABLE.has(mimeType)) return;
  const stem = filename.replace(/\.[^.]+$/, '');
  const source = path.join(UPLOAD_DIR, filename);
  for (const [label, width] of VARIANTS) {
    try {
      await sharp(source)
        .rotate() // respect EXIF orientation
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(path.join(UPLOAD_DIR, `${stem}@${label}.webp`));
    } catch {
      // best-effort — the original always remains usable
    }
  }
}
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
  res.json(rows.map((r) => ({ ...r, url: `/uploads/${r.filename}`, variants: variantUrls(r.filename) })));
});

router.post('/', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'file is required' });
    const db = getDb();
    const usedBytes = db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM media WHERE team_id = ?').get(req.team.id).n;
    const planHit = overLimit(req.team, 'media_mb', (usedBytes + req.file.size) / (1024 * 1024));
    if (planHit) {
      fs.rm(path.join(UPLOAD_DIR, req.file.filename), { force: true }, () => {});
      return res.status(planHit.status).json({ error: planHit.error });
    }
    const result = db
      .prepare(
        'INSERT INTO media (team_id, filename, original_name, mime_type, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(req.team.id, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, req.user.id);
    const row = db.prepare('SELECT * FROM media WHERE id = ?').get(result.lastInsertRowid);
    // Variants finish generating before the response so callers can use
    // them immediately; failures fall back to the original silently.
    makeVariants(row.filename, row.mime_type).finally(() => {
      res.status(201).json({ ...row, url: `/uploads/${row.filename}`, variants: variantUrls(row.filename) });
    });
  });
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM media WHERE id = ? AND team_id = ?').get(req.params.id, req.team.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM media WHERE id = ?').run(row.id);
  fs.rm(path.join(UPLOAD_DIR, row.filename), { force: true }, () => {});
  const stem = row.filename.replace(/\.[^.]+$/, '');
  for (const label of ['md', 'sm']) {
    fs.rm(path.join(UPLOAD_DIR, `${stem}@${label}.webp`), { force: true }, () => {});
  }
  res.json({ ok: true });
});

module.exports = router;
