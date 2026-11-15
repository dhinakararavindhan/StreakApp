import { todayKey } from './rng'
const KEY = 'chase300.v1'
const empty = { streak: 0, best: 0, bestBowl: null, bowlLevel: 1, bowlCleared: 0, lastPlayed: null, history: {}, played: 0, wins: 0 }

export function load() {
  try { return { ...empty, ...JSON.parse(localStorage.getItem(KEY) || '{}') } } catch { return { ...empty } }
}
function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)) } catch {} }

const dayDiff = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000)
export const histKey = (kind, day) => (kind === 'bowl' ? 'bowl:' + day : day)

// Effective streak: shows 0 if the player missed yesterday and hasn't played today.
export function liveStreak(s, today = todayKey()) {
  if (!s.lastPlayed) return 0
  return dayDiff(s.lastPlayed, today) <= 1 ? s.streak : 0
}

function bump(s, kind, score, won, level) {
  if (kind === 'bowl') {
    s.bestBowl = s.bestBowl == null ? score : Math.min(s.bestBowl, score)
    // winning a level unlocks the next one
    if (won) {
      s.bowlCleared = Math.max(s.bowlCleared || 0, level)
      s.bowlLevel = Math.min(10, Math.max(s.bowlLevel || 1, level + 1))
    }
  }
  if (kind !== 'bowl') s.best = Math.max(s.best, score)
  s.played += 1
  if (won) s.wins += 1
}

// Either daily challenge keeps the streak alive; it grows once per day.
export function recordDaily(kind, score, won, level = 1, today = todayKey()) {
  const s = load()
  const k = histKey(kind, today)
  if (s.history[k]) return s
  if (s.lastPlayed !== today) {
    const d = s.lastPlayed ? dayDiff(s.lastPlayed, today) : null
    s.streak = d === 1 ? s.streak + 1 : 1
    s.lastPlayed = today
  }
  bump(s, kind, score, won, level)
  s.history[k] = { score, won, level }
  save(s)
  return s
}
export function recordPractice(kind, score, won, level = 1) {
  const s = load()
  bump(s, kind, score, won, level)
  save(s)
  return s
}
