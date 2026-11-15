import { todayKey } from './rng'
import { BAT_LEVELS, BOWL_LEVELS } from './data'
const KEY = 'chase300.v1'
const empty = { streak: 0, bestStreak: 0, vsPlayed: 0, best: 0, bestBowl: null, bowlLevel: 1, bowlCleared: 0, batLevel: 1, batCleared: 0, lastPlayed: null, history: {}, played: 0, wins: 0 }

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
      s.bowlLevel = Math.min(BOWL_LEVELS, Math.max(s.bowlLevel || 1, level + 1))
    }
  }
  if (kind !== 'bowl') {
    s.best = Math.max(s.best, score)
    if (won) {
      s.batCleared = Math.max(s.batCleared || 0, level)
      s.batLevel = Math.min(BAT_LEVELS, Math.max(s.batLevel || 1, level + 1))
    }
  }
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
    s.bestStreak = Math.max(s.bestStreak || 0, s.streak)
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

export function recordVs() {
  const s = load()
  s.vsPlayed = (s.vsPlayed || 0) + 1
  save(s)
  return s
}
export const seenIntro = () => { try { return localStorage.getItem('chase300.seen') === '1' } catch { return true } }
export const markIntroSeen = () => { try { localStorage.setItem('chase300.seen', '1') } catch {} }

// ---- badges (all derived from saved stats) ----
export const BADGES = [
  { id: 'first', icon: '🏏', name: 'First innings', desc: 'Play your first game', test: (s) => s.played >= 1 },
  { id: 'win', icon: '🏆', name: 'First win', desc: 'Win any level', test: (s) => s.wins >= 1 },
  { id: 'str3', icon: '🔥', name: 'On a roll', desc: '3-day streak', test: (s) => (s.bestStreak || s.streak) >= 3 },
  { id: 'str7', icon: '📆', name: 'Week warrior', desc: '7-day streak', test: (s) => (s.bestStreak || s.streak) >= 7 },
  { id: 'str30', icon: '🗓️', name: 'Regular', desc: '30-day streak', test: (s) => (s.bestStreak || s.streak) >= 30 },
  { id: 'bat5', icon: '🥉', name: 'Chaser', desc: 'Clear batting level 5', test: (s) => (s.batCleared || 0) >= 5 },
  { id: 'bat10', icon: '🥈', name: 'Finisher', desc: 'Clear batting level 10', test: (s) => (s.batCleared || 0) >= 10 },
  { id: 'bat13', icon: '👑', name: 'The impossible', desc: 'Clear batting level 13 (320)', test: (s) => (s.batCleared || 0) >= 13 },
  { id: 'bowl5', icon: '🎯', name: 'Strangler', desc: 'Clear bowling level 5', test: (s) => (s.bowlCleared || 0) >= 5 },
  { id: 'bowl10', icon: '🧨', name: 'Untouchable', desc: 'Clear bowling level 10', test: (s) => (s.bowlCleared || 0) >= 10 },
  { id: 'vs1', icon: '⚔️', name: 'Challenger', desc: 'Play a friend challenge', test: (s) => (s.vsPlayed || 0) >= 1 },
  { id: 'p50', icon: '💯', name: 'Veteran', desc: 'Play 50 games', test: (s) => s.played >= 50 },
]
