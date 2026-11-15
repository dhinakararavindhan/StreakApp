const KEY = 'chase300.device'
export function deviceId() {
  try {
    let d = localStorage.getItem(KEY)
    if (!d) { d = crypto.randomUUID(); localStorage.setItem(KEY, d) }
    return d
  } catch { return 'anon-' + Math.random().toString(36).slice(2, 12) }
}
export const getName = () => { try { return localStorage.getItem('chase300.name') || '' } catch { return '' } }
export const setName = (n) => { try { localStorage.setItem('chase300.name', n) } catch {} }

async function j(path, opts) {
  const r = await fetch('/api' + path, { headers: { 'content-type': 'application/json' }, ...opts })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(body.error || 'request failed'), { status: r.status })
  return body
}
export const submitScore = (kind, name, day, picks) =>
  j('/score', { method: 'POST', body: JSON.stringify({ device: deviceId(), kind, name, day, xi: picks.map((p) => p.id) }) })
export const fetchBoard = (kind, scope, day) =>
  j(`/leaderboard?kind=${kind}&scope=${scope}&day=${encodeURIComponent(day)}&device=${encodeURIComponent(deviceId())}`)

// ---- push ----
const b64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

export async function pushEnabled() {
  if (!pushSupported()) return false
  const reg = await navigator.serviceWorker.ready
  return !!(await reg.pushManager.getSubscription())
}
export async function enablePush() {
  const { key } = await j('/push/key')
  if (!key) throw new Error('Reminders aren’t available on this server')
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications are blocked')
  const reg = await navigator.serviceWorker.ready
  const sub = (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) }))
  await j('/push/subscribe', { method: 'POST', body: JSON.stringify({ device: deviceId(), sub: sub.toJSON(), tz: new Date().getTimezoneOffset() }) })
}
export async function disablePush() {
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (sub) await sub.unsubscribe()
  await j('/push/unsubscribe', { method: 'POST', body: JSON.stringify({ device: deviceId() }) })
}
