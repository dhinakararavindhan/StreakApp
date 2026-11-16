import React from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import '@fontsource-variable/plus-jakarta-sans'
import App from './App.jsx'
import './styles.css'
import { applyTheme, getTheme } from './util.js'

applyTheme(getTheme())
// Auto-update: look for a new version on open, on return to the app and every few minutes. When one is ready the app
// reloads itself, except in the middle of a game (progress is saved, so it offers a one-tap reload and reloads as soon as the game ends).
registerSW({
  immediate: true,
  onRegisteredSW(_url, reg) {
    if (!reg) return
    const check = () => { try { reg.update() } catch {} }
    setInterval(check, 5 * 60 * 1000)
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check() })
    window.addEventListener('online', check)
  },
})
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller // first install: nothing to reload
  let pending = false
  const reload = () => { try { window.location.reload() } catch {} }
  const banner = () => {
    if (document.getElementById('upd')) return
    const d = document.createElement('div'); d.id = 'upd'
    d.innerHTML = '<span>🔄 New version ready</span><button type="button">Reload</button>'
    d.querySelector('button').onclick = reload
    document.body.appendChild(d)
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || pending) return
    pending = true
    if (!window.__chaseBusy) return reload()
    banner()
    const t = setInterval(() => { if (!window.__chaseBusy) { clearInterval(t); reload() } }, 1500)
  })
}
createRoot(document.getElementById('root')).render(<App />)
