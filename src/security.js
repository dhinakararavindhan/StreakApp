/** Security middleware: rate limiting and response headers.
    In-memory limiter — swap for a Redis-backed store when running
    multiple nodes (see ROADMAP Phase 4). */

function rateLimit({ windowMs = 10 * 60 * 1000, max = 30, name = 'requests' } = {}) {
  const hits = new Map(); // key -> [timestamps]
  return (req, res, next) => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    const fresh = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (fresh.length >= max) {
      hits.set(key, fresh);
      res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ error: `Too many ${name} — try again later` });
    }
    fresh.push(now);
    hits.set(key, fresh);
    // Bound memory: drop stale keys occasionally.
    if (hits.size > 10000) {
      for (const [k, arr] of hits) {
        if (!arr.some((t) => now - t < windowMs)) hits.delete(k);
      }
    }
    next();
  };
}

function securityHeaders(req, res, next) {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
}

module.exports = { rateLimit, securityHeaders };
