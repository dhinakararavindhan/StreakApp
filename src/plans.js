/** Plans & entitlements — the monetization layer.

    Self-hosted installs default every company to 'pro' (unlimited), so
    the open-source experience never hits a wall. SaaS operators set
    NOVA_DEFAULT_PLAN=free and change plans per company from the Platform
    page (that's where a billing provider like Stripe plugs in: webhook →
    set plan). Limits are enforced at creation points with 402 responses
    that name the limit and the fix. -1 means unlimited. */

const { getDb } = require('./db');

const PLANS = {
  free: {
    label: 'Free',
    price: '$0',
    limits: { content: 25, members: 3, media_mb: 100, ai: false, custom_domain: false },
  },
  starter: {
    label: 'Starter',
    price: '$19/mo',
    limits: { content: 500, members: 10, media_mb: 2048, ai: true, custom_domain: true },
  },
  pro: {
    label: 'Pro',
    price: '$49/mo',
    limits: { content: -1, members: -1, media_mb: -1, ai: true, custom_domain: true },
  },
};

const DEFAULT_PLAN = () => (PLANS[process.env.NOVA_DEFAULT_PLAN] ? process.env.NOVA_DEFAULT_PLAN : 'pro');

function planOf(team) {
  return PLANS[team.plan] ? team.plan : DEFAULT_PLAN();
}

function limitsOf(team) {
  return PLANS[planOf(team)].limits;
}

function usageOf(teamId) {
  const db = getDb();
  return {
    content: db.prepare('SELECT COUNT(*) AS n FROM content WHERE team_id = ? AND deleted_at IS NULL').get(teamId).n,
    members: db.prepare('SELECT COUNT(*) AS n FROM team_members WHERE team_id = ?').get(teamId).n,
    media_mb: Math.round(
      (db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM media WHERE team_id = ?').get(teamId).n / (1024 * 1024)) * 10
    ) / 10,
  };
}

/** 402 helper: null when allowed, else {status, error} naming the limit. */
function overLimit(team, kind, nextValue) {
  const limit = limitsOf(team)[kind];
  if (limit === -1 || limit === true) return null;
  if (limit === false) {
    return {
      status: 402,
      error: `The ${PLANS[planOf(team)].label} plan doesn't include this feature — upgrade to unlock it`,
    };
  }
  if (nextValue > limit) {
    const noun = { content: 'content items', members: 'members', media_mb: 'MB of media' }[kind] || kind;
    return {
      status: 402,
      error: `Plan limit reached: the ${PLANS[planOf(team)].label} plan allows ${limit} ${noun} — upgrade to add more`,
    };
  }
  return null;
}

module.exports = { PLANS, DEFAULT_PLAN, planOf, limitsOf, usageOf, overLimit };
