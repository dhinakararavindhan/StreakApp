// Tiny dependency-light backend: verified leaderboard + web-push streak reminders.
// Run: VAPID_PUBLIC=... VAPID_PRIVATE=... node server/index.js   (serves ./dist too)
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const webpush = createRequire(import.meta.url)('web-push')
import { SQUADS, batTarget, bowlTarget, BOWL_MIN, BAT_LEVELS, BOWL_LEVELS } from '../src/data.js'
import { simulate, simulateBowl, opponentFor } from '../src/sim.js'
import { rng, hashStr, todayKey } from '../src/rng.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(__dirname, '..', 'dist')
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'db.json')
const PORT = Number(process.env.PORT || 8787)
const REMINDER_HOUR = Number(process.env.REMINDER_HOUR || 18) // local hour of the player

// ---------- storage (atomic JSON file) ----------
let db = { scores: [], subs: {}, vs: {} } // scores: {device,name,day,score,wickets,won,balls,xi}; subs: device -> {sub,tz,lastReminded}
try { db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) } } catch {}
let dirty = false
const save = () => { dirty = true }
setInterval(() => {
  if (!dirty) return
  dirty = false
  fs.writeFileSync(DB_FILE + '.tmp', JSON.stringify(db))
  fs.renameSync(DB_FILE + '.tmp', DB_FILE)
}, 2000).unref()

// ---------- push ----------
const pushOn = !!(process.env.VAPID_PUBLIC && process.env.VAPID_PRIVATE)
if (pushOn) webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', process.env.VAPID_PUBLIC, process.env.VAPID_PRIVATE)
else console.warn('VAPID keys not set: push reminders disabled (generate with `npx web-push generate-vapid-keys`)')

const localDay = (tz) => todayKey(new Date(Date.now() - tz * 60000)) // tz = Date#getTimezoneOffset()
const localHour = (tz) => new Date(Date.now() - tz * 60000).getUTCHours()
const streakOf = (device, today) => {
  const days = new Set(db.scores.filter((s) => s.device === device).map((s) => s.day))
  let n = 0, d = new Date(today + 'T00:00:00Z')
  if (!days.has(today)) d.setUTCDate(d.getUTCDate() - 1)
  while (days.has(d.toISOString().slice(0, 10))) { n++; d.setUTCDate(d.getUTCDate() - 1) }
  return n
}
async function sendReminders() {
  if (!pushOn) return
  for (const [device, rec] of Object.entries(db.subs)) {
    const today = localDay(rec.tz)
    if (localHour(rec.tz) < REMINDER_HOUR || rec.lastReminded === today) continue
    if (db.scores.some((s) => s.device === device && s.day === today)) continue
    const streak = streakOf(device, today)
    const body = streak > 0 ? `Your ${streak}-day streak ends tonight. Today's wheel is waiting! 🔥` : "Today's wheel is ready. Can you chase 500?"
    try {
      await webpush.sendNotification(rec.sub, JSON.stringify({ title: 'Chase 500', body, url: '/' }))
      rec.lastReminded = today; save()
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) { delete db.subs[device]; save() }
    }
  }
}
setInterval(sendReminders, 10 * 60 * 1000).unref()

// ---------- score verification ----------
const byId = new Map(SQUADS.flatMap((s) => s.players.map((p) => [p.id, p])))
function verify(kind, ids, day, level) {
  if (kind === 'bowl') {
    if (!Array.isArray(ids) || ids.length !== 5) return null
    const attack = ids.map((id) => byId.get(id))
    if (attack.some((p) => !p || p.bwl < BOWL_MIN)) return null
    if (new Set(attack.map((p) => p.name)).size !== 5) return null
    const rand = rng(hashStr(day + 'bowl' + attack.map((p) => p.id).join('|')))
    return simulateBowl(attack, opponentFor(day).players, rand, bowlTarget(level))
  }
  if (!Array.isArray(ids) || ids.length !== 11) return null
  const xi = ids.map((id) => byId.get(id))
  if (xi.some((p, i) => !p || i + 1 < p.lo || i + 1 > p.hi)) return null
  if (new Set(xi.map((p) => p.name)).size !== 11) return null // a real player only once
  return simulate(xi, rng(hashStr(day + xi.map((p) => p.id).join('|'))), batTarget(level))
}
const cleanName = (n) => String(n || 'Anon').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16) || 'Anon'
const validDay = (d) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false
  const diff = Math.abs(new Date(d) - new Date(todayKey(new Date()))) / 86400000
  return diff <= 1.5 // tolerate timezones
}

function board(kind, scope, device, day) {
  const mine = db.scores.filter((s) => (s.kind || 'bat') === kind)
  // bowling: fewest runs wins. batting: chases end at their target, so rank by level first, then runs, then speed.
  const better = kind === 'bowl' ? (a, b) => a.score - b.score || b.wickets - a.wickets || a.balls - b.balls : (a, b) => (b.level || 1) - (a.level || 1) || b.score - a.score || a.balls - b.balls
  let rows
  if (scope === 'all') {
    const best = new Map()
    for (const s of mine) { const b = best.get(s.device); if (!b || better(s, b) < 0) best.set(s.device, s) }
    rows = [...best.values()]
  } else rows = mine.filter((s) => s.day === day)
  rows.sort(better)
  const ranked = rows.map((s, i) => ({ rank: i + 1, name: s.name, score: s.score, wickets: s.wickets, won: s.won, balls: s.balls, level: s.level || 1, you: s.device === device }))
  return { top: ranked.slice(0, 50), me: ranked.find((r) => r.you) || null, total: ranked.length }
}

// ---------- friend challenges ----------
const VS_TTL = 14 * 86400000
const VS_MAX = 20
const validCode = (c) => typeof c === 'string' && /^[A-Z0-9]{6}$/.test(c)
function vsView(code, device) {
  const ch = db.vs[code]
  if (!ch) return null
  const better = ch.kind === 'bowl' ? (a, b) => a.score - b.score || b.wickets - a.wickets || a.balls - b.balls : (a, b) => (b.won - a.won) || b.score - a.score || a.balls - b.balls
  const entries = [...ch.entries].sort(better).map((e, i) => ({ rank: i + 1, name: e.name, score: e.score, wickets: e.wickets, won: e.won, balls: e.balls, you: e.device === device }))
  return { code, kind: ch.kind, level: ch.level, target: ch.kind === 'bowl' ? bowlTarget(ch.level) : batTarget(ch.level), entries }
}
setInterval(() => { for (const [c, ch] of Object.entries(db.vs)) if (Date.now() - ch.created > VS_TTL) { delete db.vs[c]; save() } }, 3600000).unref()

// ---------- http ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json' }
const rate = new Map()
// behind a hosting proxy the socket address is the proxy: use the forwarded client IP
const clientIp = (req) => req.headers['fly-client-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress
const limited = (ip) => { const n = (rate.get(ip) || 0) + 1; rate.set(ip, n); return n > 120 }
setInterval(() => rate.clear(), 60000).unref()

const readJson = (req) => new Promise((res, rej) => {
  let b = ''
  req.on('data', (c) => { b += c; if (b.length > 20000) { rej(new Error('big')); req.destroy() } })
  req.on('end', () => { try { res(JSON.parse(b || '{}')) } catch (e) { rej(e) } })
})
const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  try {
    if (url.pathname === '/healthz') return send(res, 200, { ok: true })
    if (url.pathname.startsWith('/api/')) {
      if (limited(clientIp(req))) return send(res, 429, { error: 'slow down' })
      if (req.method === 'GET' && url.pathname === '/api/leaderboard') {
        return send(res, 200, board(url.searchParams.get('kind') === 'bowl' ? 'bowl' : 'bat', url.searchParams.get('scope') === 'all' ? 'all' : 'today', url.searchParams.get('device'), url.searchParams.get('day')))
      }
      const vm = url.pathname.match(/^\/api\/vs\/([A-Za-z0-9]{6})$/)
      if (vm) {
        const code = vm[1].toUpperCase()
        if (req.method === 'GET') {
          const view = vsView(code, url.searchParams.get('device'))
          return view ? send(res, 200, view) : send(res, 404, { error: 'not found' })
        }
        if (req.method === 'POST') {
          const body = await readJson(req)
          const { device, name, xi } = body
          if (typeof device !== 'string' || device.length < 8 || device.length > 64) return send(res, 400, { error: 'bad device' })
          let ch = db.vs[code]
          const kind = ch ? ch.kind : body.kind === 'bowl' ? 'bowl' : 'bat'
          const max = kind === 'bowl' ? BOWL_LEVELS : BAT_LEVELS
          const level = ch ? ch.level : Math.min(max, Math.max(1, Number(body.level) | 0 || 1))
          const r = verify(kind, xi, 'vs-' + code, level)
          if (!r) return send(res, 400, { error: 'invalid picks' })
          if (!ch) { ch = db.vs[code] = { kind, level, created: Date.now(), entries: [] } }
          if (ch.entries.some((e) => e.device === device)) return send(res, 409, { error: 'already played' })
          if (ch.entries.length >= VS_MAX) return send(res, 409, { error: 'challenge full' })
          ch.entries.push({ device, name: cleanName(name), score: r.score, wickets: r.wickets, won: r.won, balls: r.ballsUsed })
          save()
          return send(res, 200, vsView(code, device))
        }
      }
      if (req.method === 'GET' && url.pathname === '/api/push/key') return send(res, 200, { key: pushOn ? process.env.VAPID_PUBLIC : null })
      if (req.method === 'POST' && url.pathname === '/api/score') {
        const body = await readJson(req)
        const { device, name, day, xi } = body
        const kind = body.kind === 'bowl' ? 'bowl' : 'bat'
        if (typeof device !== 'string' || device.length < 8 || device.length > 64) return send(res, 400, { error: 'bad device' })
        if (!validDay(day)) return send(res, 400, { error: 'bad day' })
        const level = Math.min(kind === 'bowl' ? BOWL_LEVELS : BAT_LEVELS, Math.max(1, Number(body.level) | 0 || 1))
        const r = verify(kind, xi, day, level)
        if (!r) return send(res, 400, { error: 'invalid XI' })
        if (db.scores.some((s) => s.device === device && s.day === day && (s.kind || 'bat') === kind)) return send(res, 409, { error: 'already submitted' })
        db.scores.push({ device, kind, level, name: cleanName(name), day, score: r.score, wickets: r.wickets, won: r.won, balls: r.ballsUsed })
        save()
        return send(res, 200, { score: r.score, ...board(kind, 'today', device, day) })
      }
      if (req.method === 'POST' && url.pathname === '/api/push/subscribe') {
        if (!pushOn) return send(res, 503, { error: 'push disabled' })
        const { device, sub, tz } = await readJson(req)
        if (typeof device !== 'string' || !sub?.endpoint || !Number.isFinite(tz)) return send(res, 400, { error: 'bad request' })
        db.subs[device] = { sub, tz, lastReminded: db.subs[device]?.lastReminded || null }
        save()
        return send(res, 200, { ok: true })
      }
      if (req.method === 'POST' && url.pathname === '/api/push/unsubscribe') {
        const { device } = await readJson(req)
        delete db.subs[device]; save()
        return send(res, 200, { ok: true })
      }
      return send(res, 404, { error: 'not found' })
    }
    // static files (built PWA)
    let f = path.normalize(path.join(DIST, url.pathname === '/' ? 'index.html' : url.pathname))
    if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html')
    const type = MIME[path.extname(f)] || 'application/octet-stream'
    res.writeHead(200, { 'content-type': type, 'cache-control': f.endsWith('sw.js') || f.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000' })
    fs.createReadStream(f).pipe(res)
  } catch (e) { send(res, 400, { error: 'bad request' }) }
})
server.listen(PORT, () => console.log(`Chase 300 server on :${PORT}`))
