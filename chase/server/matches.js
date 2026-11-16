// Match database: every finished game, re-verified by the server, stored as monthly NDJSON files.
// Anonymous: hashed device id, no names, no IP. Players who opt out (or say they are under 18) are never recorded.
import fs from 'node:fs'
import path from 'node:path'

const DAY = 86400000
const monthOf = (t) => new Date(t).toISOString().slice(0, 7)
const file = (dir, m) => path.join(dir, `matches-${m}.ndjson`)
const seen = new Set()
let primed = false
const prime = (dir) => {
  if (primed) return; primed = true
  for (const m of [monthOf(Date.now()), monthOf(Date.now() - 31 * DAY)]) {
    try { for (const l of fs.readFileSync(file(dir, m), 'utf8').split('\n')) { if (l) { try { seen.add(JSON.parse(l).id) } catch {} } } } catch {}
  }
}

export function recordMatch(dir, rec) {
  prime(dir)
  if (seen.has(rec.id)) return false
  seen.add(rec.id)
  fs.mkdirSync(dir, { recursive: true })
  fs.appendFileSync(file(dir, monthOf(rec.t)), JSON.stringify(rec) + '\n')
  return true
}

export function readMatches(dir, { days = 30, kind = '', mode = '', limit = 500 } = {}) {
  const out = [], since = Date.now() - days * DAY
  const months = []
  for (let t = Date.now(); t > since - 31 * DAY; t -= 28 * DAY) { const m = monthOf(t); if (!months.includes(m)) months.push(m) }
  for (const m of months.sort().reverse()) {
    let txt = ''
    try { txt = fs.readFileSync(file(dir, m), 'utf8') } catch { continue }
    for (const l of txt.split('\n').reverse()) {
      if (!l) continue
      let r; try { r = JSON.parse(l) } catch { continue }
      if (r.t < since || (kind && r.kind !== kind) || (mode && r.mode !== mode)) continue
      out.push(r); if (out.length >= limit) return out
    }
  }
  return out
}

export function matchStats(dir, days = 30) {
  const all = readMatches(dir, { days, limit: 1e6 })
  const by = (f) => all.reduce((m, r) => { const k = f(r); m[k] = (m[k] || 0) + 1; return m }, {})
  const wins = all.filter((r) => r.won).length
  const d7 = Date.now() - 7 * DAY
  return { windowDays: days, total: all.length, last7d: all.filter((r) => r.t >= d7).length, wins, winPct: all.length ? Math.round((wins * 100) / all.length) : null, byKind: by((r) => r.kind), byMode: by((r) => r.mode), impactUsed: all.filter((r) => r.impact).length }
}

export function deleteDeviceMatches(dir, h) {
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!/^matches-.*\.ndjson$/.test(f)) continue
      const p = path.join(dir, f)
      const kept = fs.readFileSync(p, 'utf8').split('\n').filter((l) => l && !l.includes(`"d":"${h}"`))
      fs.writeFileSync(p, kept.length ? kept.join('\n') + '\n' : '')
    }
  } catch {}
}

export function purgeOldMatches(dir, keepDays = 365) {
  try {
    const cutoff = monthOf(Date.now() - keepDays * DAY)
    for (const f of fs.readdirSync(dir)) { const m = f.match(/^matches-(\d{4}-\d{2})\.ndjson$/); if (m && m[1] < cutoff) fs.unlinkSync(path.join(dir, f)) }
  } catch {}
}

export const toCsv = (rows) => {
  const cols = ['t', 'id', 'd', 'kind', 'mode', 'level', 'score', 'wk', 'balls', 'won', 'tie', 'oppScore', 'opp', 'text', 'first', 'impact', 'cap', 'xi', 'attack', 'seed']
  const q = (v) => { v = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v }
  return cols.join(',') + '\n' + rows.map((r) => cols.map((c) => q(c === 't' ? new Date(r.t).toISOString() : c === 'opp' && r.opp ? r.opp.name + ' ' + r.opp.year : r[c])).join(',')).join('\n') + '\n'
}
