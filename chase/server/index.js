// Tiny dependency-light backend: verified leaderboard + web-push streak reminders.
// Run: VAPID_PUBLIC=... VAPID_PRIVATE=... node server/index.js   (serves ./dist too)
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const webpush = createRequire(import.meta.url)('web-push')
import { SQUADS, batTarget, bowlTarget, BOWL_MIN, BAT_LEVELS, BOWL_LEVELS, OPEN_TARGET } from '../src/data.js'
import { simulate, simulateBowl, simulateSuper, superOpponent, opponentFor, simulateFull } from '../src/sim.js'
import { conditionFor, modifierFor, pickAllowed, orderOK, dailyPoints, mondayOf } from '../src/rules.js'
import crypto from 'node:crypto'
import * as AN from './analytics.js'
import { AGE_BANDS, STATES, TEAM_CITIES } from '../src/profile.js'
import { rng, hashStr, todayKey } from '../src/rng.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(__dirname, '..', 'dist')
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'db.json')
const PORT = Number(process.env.PORT || 8787)
const REMINDER_HOUR = Number(process.env.REMINDER_HOUR || 18) // local hour of the player

// ---------- storage (atomic JSON file) ----------
let db = { scores: [], subs: {}, vs: {}, users: {}, profiles: {}, salt: '' } // scores: {device,name,day,score,wickets,won,balls,xi}; subs: device -> {sub,tz,lastReminded}
try { db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) } } catch {}
AN.ensureSalt(db)
const DATA_DIR = path.dirname(DB_FILE)
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || ''
AN.purgeOld(DATA_DIR)
let dirty = true // persist the freshly generated salt
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest()
const adminOK = (req) => !!ADMIN_TOKEN && crypto.timingSafeEqual(sha(req.headers['x-admin-token'] || ''), sha(ADMIN_TOKEN))
// cloud backups: one file per code, named by a one-way hash (the code itself is never stored)
const validSaveCode = (c) => typeof c === 'string' && /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/.test(c)
const savePath = (code) => path.join(DATA_DIR, 'saves', crypto.createHash('sha256').update('save|' + code).digest('hex').slice(0, 40) + '.json')
const validDevice = (d) => typeof d === 'string' && d.length >= 8 && d.length <= 64
const save = () => { dirty = true }
setInterval(() => {
  if (!dirty) return
  dirty = false
  fs.writeFileSync(DB_FILE + '.tmp', JSON.stringify(db))
  fs.renameSync(DB_FILE + '.tmp', DB_FILE)
}, 2000).unref()

// ---------- push ----------
// VAPID keys: use env vars if provided, otherwise generate once and keep them in the db file (survives restarts on the disk).
let vapidPublic = process.env.VAPID_PUBLIC, vapidPrivate = process.env.VAPID_PRIVATE
if (!vapidPublic || !vapidPrivate) {
  if (!db.vapid) { db.vapid = webpush.generateVAPIDKeys(); save() }
  vapidPublic = db.vapid.publicKey; vapidPrivate = db.vapid.privateKey
}
const pushOn = true
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', vapidPublic, vapidPrivate)

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
    const body = streak > 0 ? `Your ${streak}-day streak ends tonight. Today's wheel is waiting! 🔥` : "Today's wheel is ready. Can you chase 300?"
    try {
      await webpush.sendNotification(rec.sub, JSON.stringify({ title: 'Chase 300', body, url: '/' }))
      rec.lastReminded = today; save()
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) { delete db.subs[device]; save() }
    }
  }
}
setInterval(sendReminders, 10 * 60 * 1000).unref()

// every pick must satisfy the day's twist given the OTHER picks (a player must not be compared with himself)
const twistOK = (mod, list) => list.every((p) => pickAllowed(mod, p, list.filter((q) => q !== p)))

// ---------- score verification ----------
const byId = new Map(SQUADS.flatMap((s) => s.players.map((p) => [p.id, p])))
function verify(kind, ids, seed, level, cap = -1, target, extra = {}) {
  const cond = conditionFor(seed), mod = modifierFor(seed)
  const capOK = (n) => Number.isInteger(cap) && cap >= -1 && cap < n
  if (kind === 'full') {
    // a whole match: the XI (batting order), five bowlers chosen from that XI, and who goes first
    if (!Array.isArray(ids) || ids.length !== 11 || !capOK(11)) return null
    const xi = ids.map((id) => byId.get(id))
    if (xi.some((p) => !p) || !orderOK(xi) || new Set(xi.map((p) => p.name)).size !== 11 || !twistOK(mod, xi)) return null
    const at = extra.attack
    if (!Array.isArray(at) || at.length !== 5 || new Set(at).size !== 5) return null
    if (extra.first !== 'bat' && extra.first !== 'bowl') return null
    const attack = at.map((id) => byId.get(id))
    if (attack.some((p) => !p)) return null
    // optional Impact Player (needs a different real player, allowed by the twist, and a valid XI slot to replace)
    let impact = null
    if (extra.impact) {
      const ip = byId.get(extra.impact.id), out = extra.impact.out
      if (!ip || !Number.isInteger(out) || out < 0 || out > 10) return null
      const all = [...xi, ip]
      if (new Set(all.map((p) => p.name)).size !== 12 || !twistOK(mod, all)) return null
      impact = { p: ip, out }
      const pool = extra.first === 'bat' ? xi.map((q, i) => (i === out ? ip : q)) : xi
      if (extra.first === 'bowl' && !orderOK(xi.map((q, i) => (i === out ? ip : q)))) return null
      if (attack.some((p) => !pool.includes(p))) return null
    } else if (attack.some((p) => !xi.includes(p))) return null
    const res = simulateFull(xi, attack, { seedStr: seed, cap, first: extra.first, cond, impact })
    return { ...res, score: res.myScore, wickets: res.myBatting.wickets, ballsUsed: res.myBatting.ballsUsed, target: 0 }
  }
  if (kind === 'super') {
    if (!Array.isArray(ids) || ids.length !== 4 || !capOK(3)) return null
    const picks = ids.map((id) => byId.get(id))
    if (picks.some((p) => !p) || picks[3].bwl < BOWL_MIN) return null
    if (new Set(picks.map((p) => p.name)).size !== 4) return null
    if (!twistOK(mod, picks)) return null
    const res = simulateSuper(picks, superOpponent(seed), rng(hashStr(seed + 'super' + picks.map((p) => p.id).join('|'))), { cap, cond })
    return { ...res, target: 0 }
  }
  if (kind === 'bowl') {
    if (!Array.isArray(ids) || ids.length !== 5 || !capOK(5)) return null
    const attack = ids.map((id) => byId.get(id))
    if (attack.some((p) => !p || p.bwl < BOWL_MIN)) return null
    if (new Set(attack.map((p) => p.name)).size !== 5) return null
    if (!twistOK(mod, attack)) return null
    const rand = rng(hashStr(seed + 'bowl' + attack.map((p) => p.id).join('|')))
    return simulateBowl(attack, opponentFor(seed).players, rand, target ?? bowlTarget(level), { cap, cond })
  }
  if (!Array.isArray(ids) || ids.length !== 11 || !capOK(11)) return null
  const xi = ids.map((id) => byId.get(id))
  if (xi.some((p) => !p) || !orderOK(xi)) return null
  if (new Set(xi.map((p) => p.name)).size !== 11) return null // a real player only once
  if (!twistOK(mod, xi)) return null
  return simulate(xi, rng(hashStr(seed + xi.map((p) => p.id).join('|'))), target ?? batTarget(level), { cap, cond })
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

// ---------- weekly tournament & daily recap ----------
function weekly(day, device) {
  const start = mondayOf(day)
  const endD = new Date(start + 'T00:00:00Z'); endD.setUTCDate(endD.getUTCDate() + 6)
  const end = endD.toISOString().slice(0, 10)
  const by = new Map()
  for (const s of db.scores) {
    if (s.day < start || s.day > end) continue
    const e = by.get(s.device) || { name: s.name, pts: 0, games: 0 }
    e.pts += s.pts || 0; e.games += 1; e.name = s.name
    by.set(s.device, e)
  }
  const rows = [...by.entries()].map(([d, e]) => ({ ...e, you: d === device })).sort((a, b) => b.pts - a.pts || a.games - b.games)
  const ranked = rows.map((r, i) => ({ rank: i + 1, ...r }))
  return { start, end, top: ranked.slice(0, 50), me: ranked.find((r) => r.you) || null, total: ranked.length }
}
const pubPlayer = (id) => { const p = byId.get(id); return p ? { name: p.name, team: p.team, year: p.year } : { name: '?', team: '', year: 0 } }
function recap(day) {
  const out = {}
  for (const kind of ['bat', 'bowl', 'super']) {
    const rows = db.scores.filter((s) => (s.kind || 'bat') === kind && s.day === day && Array.isArray(s.xi))
    rows.sort(kind === 'bowl' ? (a, b) => a.score - b.score || b.wickets - a.wickets
      : kind === 'super' ? (a, b) => (b.score - (b.opp || 0)) - (a.score - (a.opp || 0)) || b.score - a.score
        : (a, b) => (b.level || 1) - (a.level || 1) || b.score - a.score || a.balls - b.balls)
    out[kind] = rows.slice(0, 3).map((s, i) => ({ rank: i + 1, name: s.name, score: s.score, wickets: s.wickets, opp: s.opp, won: s.won, level: s.level || 1, cap: s.cap, xi: s.xi.map(pubPlayer) }))
  }
  return { day, ...out }
}

// ---------- friend challenges ----------
const VS_TTL = 14 * 86400000
const VS_MAX = 20
const validCode = (c) => typeof c === 'string' && /^[A-Z0-9]{6}$/.test(c)
// Head-to-head: the first entry sets the score; later entries chase it.
//  batting: target = first score + 1 (reach it to win, equal the first score to tie)
//  bowling: concede fewer runs than the first player to win, equal to tie
function vsOutcome(ch, r) {
  if (ch.kind === 'bowl') return r.score < ch.firstScore ? 'beat' : r.score === ch.firstScore ? 'tie' : 'lost'
  return r.score >= ch.target ? 'beat' : r.score === ch.firstScore ? 'tie' : 'lost'
}
function vsView(code, device) {
  const ch = db.vs[code]
  if (!ch) return null
  const order = { set: 0, beat: 1, tie: 2, lost: 3 }
  const [first, ...rest] = ch.entries
  rest.sort((a, b) => (order[a.outcome] ?? 3) - (order[b.outcome] ?? 3) || (ch.kind === 'bowl' ? a.score - b.score : b.score - a.score))
  const entries = [first, ...rest].filter(Boolean).map((e, i) => ({ rank: i + 1, name: e.name, score: e.score, wickets: e.wickets, won: e.won, balls: e.balls, outcome: e.outcome || (i === 0 ? 'set' : ''), you: e.device === device }))
  return { code, kind: ch.kind, target: ch.target, firstScore: ch.firstScore, creator: first ? first.name : '', entries }
}
setInterval(() => { for (const [c, ch] of Object.entries(db.vs)) if (Date.now() - ch.created > VS_TTL) { delete db.vs[c]; save() } }, 3600000).unref()

// ---------- http ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json' }
const rate = new Map()
// behind a hosting proxy the socket address is the proxy: use the forwarded client IP
const clientIp = (req) => req.headers['fly-client-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress
const limited = (ip) => { const n = (rate.get(ip) || 0) + 1; rate.set(ip, n); return n > 120 }
setInterval(() => rate.clear(), 60000).unref()

const readJson = (req, max = 20000) => new Promise((res, rej) => {
  let b = ''
  req.on('data', (c) => { b += c; if (b.length > max) { rej(new Error('big')); req.destroy() } })
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
          const isFirst = !ch
          const r = verify(kind, xi, 'vs-' + code, 1, body.cap === undefined ? -1 : Number(body.cap), isFirst ? OPEN_TARGET : ch.target)
          if (!r) return send(res, 400, { error: 'invalid picks' })
          if (isFirst) ch = db.vs[code] = { kind, created: Date.now(), firstScore: r.score, target: kind === 'bowl' ? r.score : r.score + 1, entries: [] }
          if (ch.entries.some((e) => e.device === device)) return send(res, 409, { error: 'already played' })
          if (ch.entries.length >= VS_MAX) return send(res, 409, { error: 'challenge full' })
          ch.entries.push({ device, name: cleanName(name), score: r.score, wickets: r.wickets, won: isFirst ? false : r.won, balls: r.ballsUsed, outcome: isFirst ? 'set' : vsOutcome(ch, r) })
          save()
          return send(res, 200, vsView(code, device))
        }
      }
      if (req.method === 'POST' && url.pathname === '/api/event') {
        const body = await readJson(req)
        const ua = AN.uaInfo(req.headers['user-agent'])
        const ctx = { ...ua, country: String(req.headers['cf-ipcountry'] || req.headers['x-vercel-ip-country'] || '').slice(0, 2).toUpperCase(), pwa: body.pwa === 1 }
        const n = AN.ingest(db, DATA_DIR, body.device, body.events, ctx)
        if (n) save()
        res.writeHead(204); return res.end()
      }
      if (url.pathname === '/api/profile' && (req.method === 'PUT' || req.method === 'DELETE')) {
        const body = await readJson(req)
        if (!validDevice(body.device)) return send(res, 400, { error: 'bad device' })
        const h = AN.hashDevice(db, body.device)
        if (req.method === 'DELETE') { delete db.profiles[h]; save(); return send(res, 200, { ok: true }) }
        if (body.consent !== true) return send(res, 400, { error: 'consent required' })
        // players under 18 are never profiled
        if (body.age === 'u18') { delete db.profiles[h]; save(); return send(res, 200, { ok: true, stored: false, minor: true }) }
        if (!AGE_BANDS.some(([k]) => k === body.age) || !STATES.includes(body.state) || !TEAM_CITIES.includes(body.team)) return send(res, 400, { error: 'invalid profile' })
        db.profiles[h] = { age: body.age, state: body.state, team: body.team, at: Date.now() }
        save(); return send(res, 200, { ok: true, stored: true })
      }
      if (req.method === 'DELETE' && url.pathname === '/api/me') {
        const body = await readJson(req)
        if (!validDevice(body.device)) return send(res, 400, { error: 'bad device' })
        const before = { scores: db.scores.length }
        delete db.profiles[AN.hashDevice(db, body.device)]
        delete db.subs[body.device]
        db.scores = db.scores.filter((s) => s.device !== body.device)
        for (const ch of Object.values(db.vs)) ch.entries = ch.entries.filter((e) => e.device !== body.device)
        AN.deleteDevice(db, DATA_DIR, body.device)
        save(); return send(res, 200, { ok: true, removedScores: before.scores - db.scores.length })
      }
      if (url.pathname.startsWith('/api/admin/')) {
        if (!ADMIN_TOKEN) return send(res, 503, { error: 'admin disabled: set ADMIN_TOKEN' })
        if (!adminOK(req)) return send(res, 401, { error: 'unauthorized' })
        if (req.method === 'GET' && url.pathname === '/api/admin/summary') return send(res, 200, AN.summary(db, DATA_DIR, 30))
        if (req.method === 'POST' && url.pathname === '/api/admin/broadcast') {
          const b = await readJson(req)
          const title = String(b.title || '').slice(0, 60), text = String(b.body || '').slice(0, 160)
          if (!title || !text) return send(res, 400, { error: 'title and body required' })
          let sent = 0, failed = 0
          for (const [device, rec] of Object.entries(db.subs)) {
            try { await webpush.sendNotification(rec.sub, JSON.stringify({ title, body: text, url: '/' })); sent++ }
            catch (e) { failed++; if (e.statusCode === 404 || e.statusCode === 410) delete db.subs[device] }
          }
          save(); return send(res, 200, { sent, failed })
        }
      }
      if (url.pathname === '/api/save' && (req.method === 'PUT' || req.method === 'DELETE')) {
        const body = await readJson(req, 700000)
        if (!validSaveCode(body.code)) return send(res, 400, { error: 'bad code' })
        const f = savePath(body.code)
        if (req.method === 'DELETE') { try { fs.unlinkSync(f) } catch {} return send(res, 200, { ok: true }) }
        const b = body.blob
        if (!b || typeof b !== 'object' || typeof b.stats !== 'object' || !Array.isArray(b.matches) || b.matches.length > 100) return send(res, 400, { error: 'bad backup' })
        fs.mkdirSync(path.dirname(f), { recursive: true })
        fs.writeFileSync(f + '.tmp', JSON.stringify({ blob: b, at: Date.now() })); fs.renameSync(f + '.tmp', f)
        return send(res, 200, { ok: true, at: Date.now() })
      }
      if (req.method === 'POST' && url.pathname === '/api/restore') {
        const body = await readJson(req)
        if (!validSaveCode(body.code)) return send(res, 400, { error: 'bad code' })
        let rec; try { rec = JSON.parse(fs.readFileSync(savePath(body.code), 'utf8')) } catch { return send(res, 404, { error: 'no backup found for that code' }) }
        return send(res, 200, rec)
      }
      if (req.method === 'GET' && url.pathname === '/api/weekly') {
        const day = url.searchParams.get('day') || ''
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return send(res, 400, { error: 'bad day' })
        return send(res, 200, weekly(day, url.searchParams.get('device')))
      }
      if (req.method === 'GET' && url.pathname === '/api/recap') {
        const day = url.searchParams.get('day') || ''
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return send(res, 400, { error: 'bad day' })
        return send(res, 200, recap(day))
      }
      if (req.method === 'GET' && url.pathname === '/api/push/key') return send(res, 200, { key: vapidPublic })
      if (req.method === 'POST' && url.pathname === '/api/score') {
        const body = await readJson(req)
        const { device, name, day, xi } = body
        const kind = body.kind === 'bowl' ? 'bowl' : body.kind === 'super' ? 'super' : body.kind === 'full' ? 'full' : 'bat'
        if (typeof device !== 'string' || device.length < 8 || device.length > 64) return send(res, 400, { error: 'bad device' })
        if (!validDay(day)) return send(res, 400, { error: 'bad day' })
        const level = kind === 'super' || kind === 'full' ? 1 : Math.min(kind === 'bowl' ? BOWL_LEVELS : BAT_LEVELS, Math.max(1, Number(body.level) | 0 || 1))
        const cap = body.cap === undefined ? -1 : Number(body.cap)
        const r = verify(kind, xi, day, level, cap, undefined, { attack: body.attack, first: body.first, impact: body.impact })
        if (!r) return send(res, 400, { error: 'invalid XI' })
        if (db.scores.some((s) => s.device === device && s.day === day && (s.kind || 'bat') === kind)) return send(res, 409, { error: 'already submitted' })
        db.scores.push({ device, kind, level, name: cleanName(name), day, score: r.score, wickets: r.wickets, won: r.won, balls: r.ballsUsed, pts: dailyPoints(kind, level, r), opp: r.oppScore, xi, cap, ...(kind === 'full' ? { attack: body.attack, first: body.first, impact: body.impact || null, text: r.text } : {}) })
        save()
        return send(res, 200, { score: r.score, pts: dailyPoints(kind, level, r), text: r.text, ...(kind === 'super' || kind === 'full' ? {} : board(kind, 'today', device, day)) })
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
    if (url.pathname === '/privacy.html' && fs.existsSync(path.join(DIST, 'privacy.html'))) {
      const html = fs.readFileSync(path.join(DIST, 'privacy.html'), 'utf8').replace('REPLACE-WITH-YOUR-CONTACT-EMAIL', (process.env.CONTACT_EMAIL || 'contact email not set').replace(/[<>&"]/g, ''))
      res.writeHead(200, { 'content-type': 'text/html' }); return res.end(html)
    }
    if (url.pathname === '/admin') {
      res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' })
      return res.end(fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8'))
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
setInterval(() => AN.purgeOld(DATA_DIR), 24 * 3600 * 1000).unref()
