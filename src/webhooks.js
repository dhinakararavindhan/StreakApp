const crypto = require('crypto');
const { getDb } = require('./db');

/** Deliver an event to a company's active webhooks. Fire-and-forget with a
    5s timeout and HMAC-SHA256 signature; delivery status is recorded per
    hook. Retries/queues are a Phase 4 (Redis) concern. */
function deliver(teamId, event, payload) {
  let hooks;
  try {
    hooks = getDb()
      .prepare('SELECT * FROM webhooks WHERE team_id = ? AND active = 1')
      .all(teamId)
      .filter((h) => h.events === '*' || h.events.split(',').map((s) => s.trim()).includes(event));
  } catch {
    return;
  }
  if (!hooks.length) return;
  const body = JSON.stringify({ event, ...payload, at: new Date().toISOString() });
  for (const hook of hooks) {
    const signature = crypto.createHmac('sha256', hook.secret || '').update(body).digest('hex');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    fetch(hook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Nova-Event': event,
        'X-Nova-Signature': `sha256=${signature}`,
      },
      body,
      signal: controller.signal,
    })
      .then((r) => record(hook.id, String(r.status)))
      .catch(() => record(hook.id, 'error'))
      .finally(() => clearTimeout(timer));
  }
}

function record(id, status) {
  try {
    getDb().prepare("UPDATE webhooks SET last_status = ?, last_at = datetime('now') WHERE id = ?").run(status, id);
  } catch {
    // hook may have been deleted mid-flight
  }
}

/** The standard payload for content events. */
function contentPayload(team, row) {
  return {
    company: team.slug,
    content: { id: row.id, type: row.type, title: row.title, slug: row.slug, locale: row.locale },
  };
}

module.exports = { deliver, contentPayload };
