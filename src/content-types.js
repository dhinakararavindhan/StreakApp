/** Custom content types: per-company schemas beyond the built-in
    post/page. A type has a key (used as content.type), display names, and
    a field schema — a JSON array of {key, label, kind, options?} where
    kind is one of FIELD_KINDS. Content rows store their field values as a
    JSON object in content.fields, validated against the schema on write. */

const { getDb, slugify } = require('./db');

const FIELD_KINDS = ['text', 'longtext', 'number', 'date', 'url', 'select', 'reference'];
const BUILTIN_TYPES = ['post', 'page'];
const MAX_FIELDS = 20;

function parseSchema(row) {
  try {
    return { ...row, schema: JSON.parse(row.schema) };
  } catch {
    return { ...row, schema: [] };
  }
}

function listTypes(teamId) {
  return getDb()
    .prepare('SELECT * FROM content_types WHERE team_id = ? ORDER BY name')
    .all(teamId)
    .map(parseSchema);
}

function getType(teamId, key) {
  const row = getDb().prepare('SELECT * FROM content_types WHERE team_id = ? AND key = ?').get(teamId, key);
  return row ? parseSchema(row) : null;
}

/** Is `type` usable for content in this company? */
function isValidType(teamId, type) {
  return BUILTIN_TYPES.includes(type) || Boolean(getType(teamId, type));
}

/** Clean an untrusted field-schema definition. Returns {schema} or {error}. */
function normalizeSchema(input) {
  if (!Array.isArray(input)) return { schema: [] };
  const seen = new Set();
  const schema = [];
  for (const raw of input.slice(0, MAX_FIELDS)) {
    const label = String((raw && raw.label) || '').trim().slice(0, 60);
    if (!label) continue;
    const key = slugify(String((raw && raw.key) || label)).replace(/-/g, '_').slice(0, 40);
    if (seen.has(key)) return { error: `Duplicate field "${key}"` };
    seen.add(key);
    const kind = FIELD_KINDS.includes(raw.kind) ? raw.kind : 'text';
    const field = { key, label, kind };
    if (kind === 'reference') {
      // Optionally pin references to one content type (e.g. an Agent
      // field on a Property). Blank = any item in the company.
      const refRaw = String(raw.ref_type || raw.options || '').trim();
      field.ref_type = refRaw ? slugify(refRaw) : '';
    }
    if (kind === 'select') {
      field.options = (Array.isArray(raw.options) ? raw.options : String(raw.options || '').split(','))
        .map((o) => String(o).trim())
        .filter(Boolean)
        .slice(0, 30);
      if (!field.options.length) return { error: `Field "${label}" is a select but has no options` };
    }
    schema.push(field);
  }
  return { schema };
}

/** Validate a content row's field values against a type. Unknown keys are
    dropped; values are coerced to strings/numbers. Returns {values} or {error}. */
function validateFields(teamId, type, input) {
  if (input === undefined) return { values: undefined };
  const ct = BUILTIN_TYPES.includes(type) ? null : getType(teamId, type);
  const schema = ct ? ct.schema : [];
  const values = {};
  for (const field of schema) {
    const raw = input && input[field.key];
    if (raw === undefined || raw === null || raw === '') continue;
    if (field.kind === 'number') {
      const n = Number(raw);
      if (!Number.isFinite(n)) return { error: `Field "${field.label}" must be a number` };
      values[field.key] = n;
    } else if (field.kind === 'date') {
      const s = String(raw).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { error: `Field "${field.label}" must be YYYY-MM-DD` };
      values[field.key] = s;
    } else if (field.kind === 'url') {
      const s = String(raw).trim().slice(0, 2000);
      if (!/^(https?:)?\/\//.test(s) && !s.startsWith('/')) {
        return { error: `Field "${field.label}" must be a URL` };
      }
      values[field.key] = s;
    } else if (field.kind === 'select') {
      const s = String(raw).trim();
      if (!field.options.includes(s)) {
        return { error: `Field "${field.label}" must be one of: ${field.options.join(', ')}` };
      }
      values[field.key] = s;
    } else if (field.kind === 'reference') {
      const refId = Number(raw);
      if (!Number.isInteger(refId) || refId <= 0) {
        return { error: `Field "${field.label}" must reference a content item` };
      }
      const target = getDb()
        .prepare('SELECT type, deleted_at FROM content WHERE id = ? AND team_id = ?')
        .get(refId, teamId);
      if (!target || target.deleted_at) {
        return { error: `Field "${field.label}" references an item that doesn't exist in this company` };
      }
      if (field.ref_type && target.type !== field.ref_type) {
        return { error: `Field "${field.label}" must reference a "${field.ref_type}" item` };
      }
      values[field.key] = refId;
    } else {
      values[field.key] = String(raw).slice(0, field.kind === 'longtext' ? 10000 : 500);
    }
  }
  return { values };
}

function parseFieldValues(json) {
  if (json && typeof json === 'object' && !Array.isArray(json)) return json;
  try {
    const v = JSON.parse(json || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** Expand reference-field ids into {key: {id, title, slug, type, status}}.
    Internal view — callers serving the public must filter to live refs. */
function expandReferences(teamId, type, values) {
  const ct = BUILTIN_TYPES.includes(type) ? null : getType(teamId, type);
  if (!ct) return undefined;
  const out = {};
  for (const field of ct.schema) {
    if (field.kind !== 'reference') continue;
    const id = values[field.key];
    if (!id) continue;
    const row = getDb()
      .prepare('SELECT id, title, slug, type, status FROM content WHERE id = ? AND team_id = ? AND deleted_at IS NULL')
      .get(id, teamId);
    if (row) out[field.key] = row;
  }
  return Object.keys(out).length ? out : undefined;
}

module.exports = {
  FIELD_KINDS,
  BUILTIN_TYPES,
  listTypes,
  getType,
  isValidType,
  normalizeSchema,
  validateFields,
  parseFieldValues,
  expandReferences,
};
