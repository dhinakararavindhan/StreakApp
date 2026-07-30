const { getDb } = require('./db');

/** Append an entry to a company's audit log. Username is denormalized so
    history survives account deletion. */
function audit(teamId, user, action, target = '', detail = '') {
  getDb()
    .prepare(
      'INSERT INTO audit_log (team_id, user_id, username, action, target, detail) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(teamId, user ? user.id : null, user ? user.username : '', action, String(target).slice(0, 200), String(detail).slice(0, 500));
}

module.exports = { audit };
