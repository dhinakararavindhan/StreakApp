/** Observability: in-process request metrics (Prometheus text format)
    and best-effort error reporting to a webhook.

    Metrics are per-process; behind a load balancer, scrape each node.
    Counters cover every request, grouped by coarse route class so
    cardinality stays tiny no matter how many companies exist. */

const METRICS = {
  startedAt: Date.now(),
  requests: new Map(), // 'class|status' -> count
  latencyMsSum: 0,
  latencyCount: 0,
};

/** Coarse route class — bounded label set, no per-company cardinality. */
function routeClass(path) {
  if (path.startsWith('/api/public')) return 'public_api';
  if (path.startsWith('/api/')) return 'api';
  if (path.startsWith('/admin')) return 'admin';
  if (path.startsWith('/uploads') || path.startsWith('/assets')) return 'static';
  return 'site';
}

function metricsMiddleware(req, res, next) {
  const started = Date.now();
  res.on('finish', () => {
    const key = `${routeClass(req.path)}|${Math.floor(res.statusCode / 100)}xx`;
    METRICS.requests.set(key, (METRICS.requests.get(key) || 0) + 1);
    METRICS.latencyMsSum += Date.now() - started;
    METRICS.latencyCount += 1;
  });
  next();
}

function renderPrometheus() {
  const lines = [
    '# HELP nova_uptime_seconds Seconds since this process started',
    '# TYPE nova_uptime_seconds gauge',
    `nova_uptime_seconds ${Math.floor((Date.now() - METRICS.startedAt) / 1000)}`,
    '# HELP nova_requests_total Requests served, by route class and status class',
    '# TYPE nova_requests_total counter',
  ];
  for (const [key, count] of [...METRICS.requests.entries()].sort()) {
    const [route, status] = key.split('|');
    lines.push(`nova_requests_total{route="${route}",status="${status}"} ${count}`);
  }
  lines.push(
    '# HELP nova_request_duration_ms_sum Total request time in milliseconds',
    '# TYPE nova_request_duration_ms_sum counter',
    `nova_request_duration_ms_sum ${METRICS.latencyMsSum}`,
    '# HELP nova_request_duration_ms_count Requests measured',
    '# TYPE nova_request_duration_ms_count counter',
    `nova_request_duration_ms_count ${METRICS.latencyCount}`
  );
  return `${lines.join('\n')}\n`;
}

/** Fire-and-forget error report to NOVA_ERROR_WEBHOOK (if set). */
function reportError(err, req) {
  const url = process.env.NOVA_ERROR_WEBHOOK;
  if (!url) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: controller.signal,
    body: JSON.stringify({
      source: 'nova-cms',
      time: new Date().toISOString(),
      message: String(err && err.message),
      stack: String(err && err.stack || '').split('\n').slice(0, 8).join('\n'),
      method: req ? req.method : undefined,
      path: req ? req.originalUrl : undefined,
    }),
  })
    .catch(() => {})
    .finally(() => clearTimeout(timer));
}

module.exports = { metricsMiddleware, renderPrometheus, reportError };
