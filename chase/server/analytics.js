// Privacy-friendly analytics: anonymous events (hashed device id, no IP, no names), stored as daily NDJSON files.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { EVENT_NAMES } from '../src/profile.js'

const DAY = 86400000
const dayOf = (t) => new Date(t).toISOString().slice(0, 10)
const file = (dir, day) => path.join(dir, `events-${day}.ndjson`)
const K = 5 // audience buckets smaller than this are hidden

export const hashDevice = (db, device) => crypto.createHash('sha256').update((db.salt || '') + device).digest('hex').slice(0, 16)

export function ensureSalt(db) { if (!db.salt) db.salt = crypto.randomBytes(16).toString('hex'); db.users = db.users || {}; db.profiles = db.profiles || {} }

// coarse device info from the user agent (the raw string is never stored)
export function uaInfo(ua = '') {
  const dev = /Mobi|Android|iPhone|iPad/i.test(ua) ? 'mobile' : 'desktop'
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iOS/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'Other'
  const br = /SamsungBrowser/i.test(ua) ? 'Samsung' : /Edg\//i.test(ua) ? 'Edge' : /Firefox/i.test(ua) ? 'Firefox' : /Chrome|CriOS/i.test(ua) ? 'Chrome' : /Safari/i.test(ua) ? 'Safari' : 'Other'
  return { dev, os, br }
}

function cleanProps(p) {
  const out = {}
  if (!p || typeof p !== 'object') return out
  for (const [k, v] of Object.entries(p).slice(0, 6)) {
    if (!/^[a-z_]{1,20}$/.test(k)) continue
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.round(v)
    else if (typeof v === 'boolean') out[k] = v ? 1 : 0
    else if (typeof v === 'string') out[k] = v.slice(0, 24)
  }
  return out
}

export function ingest(db, dir, device, events, ctx) {
  ensureSalt(db)
  if (typeof device !== 'string' || device.length < 8 || device.length > 64 || !Array.isArray(events)) return 0
  const h = hashDevice(db, device), now = Date.now(), day = dayOf(now)
  const lines = []
  for (const e of events.slice(0, 20)) {
    if (!e || !EVENT_NAMES.includes(e.n)) continue
    lines.push(JSON.stringify({ t: now, d: h, s: String(e.s || '').slice(0, 12), n: e.n, p: cleanProps(e.p), c: ctx.country || '', dev: ctx.dev, os: ctx.os, br: ctx.br, pwa: ctx.pwa ? 1 : 0 }))
  }
  if (!lines.length) return 0
  fs.mkdirSync(dir, { recursive: true })
  fs.appendFileSync(file(dir, day), lines.join('\n') + '\n')
  const u = db.users[h] || (db.users[h] = { first: day, n: 0 })
  u.last = day; u.n += lines.length
  return lines.length
}

export function readEvents(dir, days) {
  const out = []
  const today = Date.now()
  for (let i = 0; i < days; i++) {
    const f = file(dir, dayOf(today - i * DAY))
    if (!fs.existsSync(f)) continue
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) { if (line) { try { out.push(JSON.parse(line)) } catch {} } }
  }
  return out
}

export function purgeOld(dir, keepDays = 180) {
  try {
    const cutoff = dayOf(Date.now() - keepDays * DAY)
    for (const f of fs.readdirSync(dir)) {
      const m = f.match(/^events-(\d{4}-\d{2}-\d{2})\.ndjson$/)
      if (m && m[1] < cutoff) fs.unlinkSync(path.join(dir, f))
    }
  } catch {}
}

// erase one device's analytics (rewrite the daily files without it)
export function deleteDevice(db, dir, device) {
  const h = hashDevice(db, device)
  delete db.users[h]
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!/^events-.*\.ndjson$/.test(f)) continue
      const p = path.join(dir, f)
      const kept = fs.readFileSync(p, 'utf8').split('\n').filter((l) => l && !l.includes(`"d":"${h}"`))
      fs.writeFileSync(p, kept.length ? kept.join('\n') + '\n' : '')
    }
  } catch {}
}

// erase many devices at once (hashed ids): one pass over each daily file
export function deleteHashes(dir, hashes) {
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!/^events-.*\.ndjson$/.test(f)) continue
      const p = path.join(dir, f)
      const kept = fs.readFileSync(p, 'utf8').split('\n').filter((l) => { if (!l) return false; const m = l.match(/"d":"([0-9a-f]+)"/); return !(m && hashes.has(m[1])) })
      fs.writeFileSync(p, kept.length ? kept.join('\n') + '\n' : '')
    }
  } catch {}
}

const bucket = (obj) => Object.fromEntries(Object.entries(obj).map(([k, n]) => [k, n < K ? `<${K}` : n]))
const count = (arr, f) => arr.reduce((m, x) => { const k = f(x); if (k) m[k] = (m[k] || 0) + 1; return m }, {})
const top = (m, n = 10) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n)

export function summary(db, dir, days = 30) {
  ensureSalt(db)
  const ev = readEvents(dir, days)
  const today = dayOf(Date.now())
  const byDay = {}
  for (const e of ev) { const d = dayOf(e.t); (byDay[d] ||= new Set()).add(e.d) }
  const series = []
  for (let i = days - 1; i >= 0; i--) {
    const d = dayOf(Date.now() - i * DAY)
    series.push({ day: d, dau: byDay[d] ? byDay[d].size : 0, new: Object.values(db.users).filter((u) => u.first === d).length })
  }
  const uniq = (n) => { const s = new Set(); for (let i = 0; i < n; i++) { const set = byDay[dayOf(Date.now() - i * DAY)]; if (set) for (const x of set) s.add(x) } return s.size }
  // retention: of users first seen N days ago, how many came back on day N
  const ret = (n) => {
    let cohort = 0, back = 0
    for (const [h, u] of Object.entries(db.users)) {
      const target = dayOf(new Date(u.first + 'T00:00:00Z').getTime() + n * DAY)
      if (target > today) continue
      cohort++
      if (byDay[target] && byDay[target].has(h)) back++
    }
    return { cohort, back, pct: cohort ? Math.round((back * 100) / cohort) : null }
  }
  const evs = (name) => ev.filter((e) => e.n === name)
  const starts = evs('game_start'), fin = evs('game_finish'), aban = evs('draft_abandon')
  const funnel = (kind) => {
    const rows = []
    const levels = new Set([...starts, ...fin].filter((e) => e.p.kind === kind && e.p.level).map((e) => e.p.level))
    for (const level of [...levels].sort((a, b) => a - b)) {
      const s = starts.filter((e) => e.p.kind === kind && e.p.level === level && e.p.mode !== 'vs').length
      const f = fin.filter((e) => e.p.kind === kind && e.p.level === level && e.p.mode !== 'vs')
      rows.push({ level, starts: s, finishes: f.length, wins: f.filter((e) => e.p.won).length, winPct: f.length ? Math.round((f.filter((e) => e.p.won).length * 100) / f.length) : null })
    }
    return rows
  }
  const sess = new Set(ev.map((e) => e.s + e.d)).size
  const sessions7 = new Set(ev.filter((e) => e.t > Date.now() - 7 * DAY).map((e) => e.s + e.d)).size
  const profiles = Object.values(db.profiles)
  return {
    generated: new Date().toISOString(), windowDays: days, note: 'UTC days; device ids are hashed; no IPs or names are stored in analytics',
    totals: { usersEver: Object.keys(db.users).length, dau: uniq(1), wau: uniq(7), mau: uniq(30), new7d: Object.values(db.users).filter((u) => u.first > dayOf(Date.now() - 7 * DAY)).length, sessions: sess, sessions7d: sessions7, games7d: starts.filter((e) => e.t > Date.now() - 7 * DAY).length },
    series, retention: { d1: ret(1), d7: ret(7) },
    modes: count(starts, (e) => (e.p.mode === 'vs' ? 'vs' : e.p.kind)),
    plays: { daily: starts.filter((e) => e.p.mode === 'daily').length, free: starts.filter((e) => e.p.mode === 'practice').length, vs: starts.filter((e) => e.p.mode === 'vs').length },
    funnel: { bat: funnel('bat'), bowl: funnel('bowl') },
    abandon: { starts: starts.length, abandoned: aban.length, pct: starts.length ? Math.round((aban.length * 100) / starts.length) : null, avgPicks: aban.length ? +(aban.reduce((a, e) => a + (e.p.picks || 0), 0) / aban.length).toFixed(1) : null },
    countries: top(count(evs('session_start'), (e) => e.c || 'unknown')),
    devices: count(evs('session_start'), (e) => e.dev), os: top(count(evs('session_start'), (e) => e.os)),
    installedShare: evs('session_start').length ? Math.round((evs('session_start').filter((e) => e.pwa).length * 100) / evs('session_start').length) : 0,
    actions: { share: evs('share').length, install: evs('install').length, pushOn: evs('push_on').length, pushOff: evs('push_off').length, vsCreate: evs('vs_create').length, vsJoin: evs('vs_join').length, howTo: evs('howto_open').length, levelsCleared: evs('level_cleared').length },
    pushSubscribers: Object.keys(db.subs || {}).length,
    audience: { profiles: profiles.length, minBucket: K, age: bucket(count(profiles, (p) => p.age)), state: bucket(count(profiles, (p) => p.state)), team: bucket(count(profiles, (p) => p.team)) },
  }
}
