// Anonymous usage stats. No names, no IP, no content: just event names and a few numbers.
// Off for anyone who opts out and for anyone who says they are under 18.
import { deviceId } from './api.js'

const OFF = 'chase300.noanalytics', MINOR = 'chase300.minor', PROFILE = 'chase300.profile'
const get = (k) => { try { return localStorage.getItem(k) } catch { return null } }
const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v) } catch {} }

export const analyticsOn = () => get(OFF) !== '1' && get(MINOR) !== '1'
export const setAnalytics = (on) => { set(OFF, on ? null : '1'); if (!on) q = [] }
export const isMinor = () => get(MINOR) === '1'
export const setMinor = (m) => { set(MINOR, m ? '1' : null); if (m) q = [] }
export const getProfile = () => { try { return JSON.parse(get(PROFILE) || 'null') } catch { return null } }
export const setProfile = (p) => set(PROFILE, p ? JSON.stringify(p) : null)
export const nudgeDismissed = () => get('chase300.nudge') === '1'
export const dismissNudge = () => set('chase300.nudge', '1')

const sid = (() => { try { let s = sessionStorage.getItem('chase300.sid'); if (!s) { s = crypto.randomUUID().slice(0, 12); sessionStorage.setItem('chase300.sid', s) } return s } catch { return 'x' } })()
const pwa = () => { try { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true } catch { return false } }

let q = [], timer = null
export function flush() {
  clearTimeout(timer); timer = null
  if (!q.length || !analyticsOn()) { q = []; return }
  const body = JSON.stringify({ device: deviceId(), pwa: pwa() ? 1 : 0, events: q.splice(0, 20) })
  try {
    if (navigator.sendBeacon && navigator.sendBeacon('/api/event', new Blob([body], { type: 'application/json' }))) return
    fetch('/api/event', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {})
  } catch {}
}
export function track(n, p = {}) {
  if (!analyticsOn()) return
  q.push({ n, p, s: sid })
  if (q.length >= 10) flush(); else if (!timer) timer = setTimeout(flush, 4000)
}
try {
  window.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush() })
  window.addEventListener('pagehide', flush)
} catch {}
