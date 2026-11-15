import { todayKey } from './rng'
const KEY = 'chase500.v1'
const empty = { streak: 0, best: 0, lastPlayed: null, history: {}, played: 0, wins: 0 }

export function load() {
  try { return { ...empty, ...JSON.parse(localStorage.getItem(KEY) || '{}') } } catch { return { ...empty } }
}
function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)) } catch {} }

const dayDiff = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000)

// Effective streak: shows 0 if the player missed yesterday and hasn't played today.
export function liveStreak(s, today = todayKey()) {
  if (!s.lastPlayed) return 0
  const d = dayDiff(s.lastPlayed, today)
  return d <= 1 ? s.streak : 0
}

export function recordDaily(score, won, today = todayKey()) {
  const s = load()
  if (s.history[today]) return s // already counted today
  const d = s.lastPlayed ? dayDiff(s.lastPlayed, today) : null
  s.streak = d === 1 ? s.streak + 1 : 1
  s.lastPlayed = today
  s.best = Math.max(s.best, score)
  s.played += 1
  if (won) s.wins += 1
  s.history[today] = { score, won }
  save(s)
  return s
}
export function recordPractice(score, won) {
  const s = load()
  s.best = Math.max(s.best, score)
  s.played += 1
  if (won) s.wins += 1
  save(s)
  return s
}
