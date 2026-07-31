/** In-app notifications: the workflow talks back. Authors hear about
    decisions on their work; admins hear about submissions; comment
    threads notify the people in them. The actor never notifies themself. */

const { getDb } = require('./db');

function push(userIds, teamId, kind, text, href = '') {
  const db = getDb();
  const stmt = db.prepare(
    'INSERT INTO notifications (user_id, team_id, kind, text, href) VALUES (?, ?, ?, ?, ?)'
  );
  for (const id of new Set(userIds.filter(Boolean))) {
    stmt.run(id, teamId, kind, text.slice(0, 300), href);
  }
}

function teamAdminIds(teamId) {
  return getDb()
    .prepare("SELECT user_id FROM team_members WHERE team_id = ? AND role = 'admin'")
    .all(teamId)
    .map((r) => r.user_id);
}

/** A manager submitted content → every company admin hears about it. */
function notifySubmission(team, row, actor) {
  push(
    teamAdminIds(team.id).filter((id) => id !== (actor && actor.id)),
    team.id,
    'submission',
    `${actor && actor.username ? actor.username : 'Someone'} submitted “${row.title}” for review`,
    `#/review/${row.id}`
  );
}

/** An admin decided → the author (and last editor) hear about it. */
function notifyDecision(team, row, action, actor, note = '') {
  const db = getDb();
  const lastEditor = db
    .prepare('SELECT edited_by FROM content_versions WHERE content_id = ? ORDER BY id DESC LIMIT 1')
    .get(row.id);
  const targets = [row.author_id, lastEditor && lastEditor.edited_by].filter(
    (id) => id && id !== (actor && actor.id)
  );
  const text =
    action === 'approve'
      ? `“${row.title}” was approved and is now live`
      : `“${row.title}” was sent back to draft${note ? ` — “${note.slice(0, 120)}”` : ''}`;
  push(targets, team.id, action === 'approve' ? 'approved' : 'rejected', text, `#/edit/${row.id}`);
}

/** A new comment → the author and everyone already in the thread hear it. */
function notifyComment(team, row, actor) {
  const db = getDb();
  const participants = db
    .prepare('SELECT DISTINCT user_id FROM content_comments WHERE content_id = ? AND user_id IS NOT NULL')
    .all(row.id)
    .map((r) => r.user_id);
  push(
    [...participants, row.author_id].filter((id) => id && id !== (actor && actor.id)),
    team.id,
    'comment',
    `${actor && actor.username ? actor.username : 'Someone'} commented on “${row.title}”`,
    `#/edit/${row.id}`
  );
}

module.exports = { notifySubmission, notifyDecision, notifyComment };
