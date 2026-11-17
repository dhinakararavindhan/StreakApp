// Cloud backup with a private recovery code (no email or login needed).
// The code is the key: anyone who has it can restore (or overwrite) the saved progress.
import { deviceId } from './api.js'
import { loadMatches, setMatches, mergeMatches } from './matches.js'
import { getProfile, setProfile } from './analytics.js'

const CODE = 'chase300.cloudcode', WHEN = 'chase300.cloudat', STATS = 'chase300.v1', DEV = 'chase300.device'
const get = (k) => { try { return localStorage.getItem(k) } catch { return null } }
const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v) } catch {} }

export const getCode = () => get(CODE)
export const lastBackup = () => Number(get(WHEN)) || null
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // no I, L, O, U
export function newCode() {
  const b = crypto.getRandomValues(new Uint8Array(16))
  const s = Array.from(b, (x) => ALPHABET[x % 32]).join('')
  return s.match(/.{4}/g).join('-')
}
export const validCode = (c) => /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/.test(c)
export const normalise = (c) => String(c || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1').match(/.{1,4}/g)?.join('-') || ''

async function api(path, method, body) {
  const r = await fetch('/api' + path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(j.error || 'failed'), { status: r.status })
  return j
}

const snapshot = () => ({ v: 1, device: deviceId(), stats: JSON.parse(get(STATS) || '{}'), matches: loadMatches(), profile: getProfile(), savedAt: Date.now() })

export async function backup(code = getCode()) {
  if (!code) throw new Error('no code')
  await api('/save', 'PUT', { code, blob: snapshot() })
  set(CODE, code); set(WHEN, String(Date.now()))
  return code
}
export async function enableBackup() { return backup(newCode()) }
export async function removeBackup() {
  const code = getCode()
  if (code) { try { await api('/save', 'DELETE', { code }) } catch {} }
  set(CODE, null); set(WHEN, null)
}

// merge a remote save into this device (keeps the best progress from both)
function mergeStats(local, remote) {
  const L = local || {}, R = remote || {}
  const out = { ...R, ...L }
  for (const k of ['batCleared', 'bowlCleared', 'bestStreak', 'played', 'wins', 'superWins', 'vsPlayed', 'best', 'freezes']) out[k] = Math.max(L[k] || 0, R[k] || 0)
  out.bestBowl = [L.bestBowl, R.bestBowl].filter((x) => x != null).reduce((a, b) => Math.min(a, b), Infinity)
  if (!isFinite(out.bestBowl)) out.bestBowl = null
  const newer = (L.lastPlayed || '') >= (R.lastPlayed || '') ? L : R
  out.streak = newer.streak || 0; out.lastPlayed = newer.lastPlayed || null
  out.history = { ...(R.history || {}), ...(L.history || {}) }
  const lv = { bat: {}, bowl: {} }
  for (const kind of ['bat', 'bowl']) {
    const a = (L.lvl || {})[kind] || {}, b = (R.lvl || {})[kind] || {}
    for (const n of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const x = a[n], y = b[n]
      if (!x || !y) { lv[kind][n] = x || y; continue }
      lv[kind][n] = { wins: Math.max(x.wins, y.wins), best: kind === 'bowl' ? Math.min(x.best, y.best) : Math.max(x.best, y.best), first: x.first < y.first ? x.first : y.first, last: x.last > y.last ? x.last : y.last }
    }
  }
  out.lvl = lv
  const log = [...(L.winLog || []), ...(R.winLog || [])]
  const key = (w) => `${w.kind}|${w.level}|${w.score}|${w.day}`
  out.winLog = [...new Map(log.map((w) => [key(w), w])).values()].sort((a, b) => (b.day || '').localeCompare(a.day || '')).slice(0, 200)
  return out
}

export async function restore(codeRaw) {
  const code = normalise(codeRaw)
  if (!validCode(code)) throw Object.assign(new Error("That code doesn't look right."), { status: 400 })
  const { blob } = await api('/restore', 'POST', { code })
  const local = JSON.parse(get(STATS) || '{}')
  set(STATS, JSON.stringify(mergeStats(local, blob.stats)))
  setMatches(mergeMatches(loadMatches(), blob.matches || []))
  if (blob.profile && !getProfile()) setProfile(blob.profile)
  if (blob.device) set(DEV, blob.device) // keep the same player identity (leaderboard entries stay yours)
  set(CODE, code); set(WHEN, String(Date.now()))
  return { matches: (blob.matches || []).length, batCleared: blob.stats?.batCleared || 0, bowlCleared: blob.stats?.bowlCleared || 0 }
}

let timer = null
// call after each finished match: backs up shortly after, if the player turned cloud backup on
export function autoBackup() {
  if (!getCode()) return
  clearTimeout(timer); timer = setTimeout(() => { backup().catch(() => {}) }, 2500)
}
