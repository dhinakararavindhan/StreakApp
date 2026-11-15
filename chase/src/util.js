import { SQUADS } from './data.js'
import { rng, hashStr } from './rng.js'

export const fits = (p, s) => s + 1 >= p.lo && s + 1 <= p.hi
export const oversStr = (b) => `${Math.floor(b / 6)}.${b % 6}`

// Deterministic list of squads for a draft (the day's twist decides which squads can spin up).
export function makeSpins(seed, pool = SQUADS) {
  const r = rng(seed)
  return Array.from({ length: 80 }, () => pool[Math.floor(r() * pool.length)])
}

// ---- theme (light by default) ----
const THEME_KEY = 'chase300.theme'
export const getTheme = () => { try { return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light' } catch { return 'light' } }
export function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t)
  const m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', t === 'dark' ? '#0c1124' : '#f3f5fb')
  try { localStorage.setItem(THEME_KEY, t) } catch {}
}

// ---- player avatars: initials on a team-coloured tile ----
const PAL = ['#5b5bf0', '#e5484d', '#12a66a', '#f59e0b', '#0ea5e9', '#d946ef', '#14b8a6', '#f97316']
export function initials(name) {
  const parts = name.replace(/\./g, ' ').split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
export const avatarColor = (p) => PAL[hashStr(p.name) % PAL.length]
