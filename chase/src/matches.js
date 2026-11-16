// Saved match history (stored on the device, and included in the cloud backup).
// Events are stored compactly and expanded back into a full scorecard on demand.
const KEY = 'chase300.matches'
const RESUME = 'chase300.resume'
const MAX = 80

const get = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null') } catch { return null } }
const put = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)) } catch {} }

export const loadMatches = () => get(KEY) || []
export function addMatch(m) {
  const list = [m, ...loadMatches().filter((x) => x.id !== m.id)].slice(0, MAX)
  put(KEY, list)
  return list
}
export const setMatches = (list) => put(KEY, list.slice(0, MAX))
export function mergeMatches(a, b) {
  const seen = new Map()
  for (const m of [...a, ...b]) if (!seen.has(m.id)) seen.set(m.id, m)
  return [...seen.values()].sort((x, y) => y.t - x.t).slice(0, MAX)
}

// ---- resume an unfinished match ----
export const loadResume = () => get(RESUME)
export const saveResume = (r) => put(RESUME, r)
export const clearResume = () => put(RESUME, null)

// ---- compact encode / expand ----
export function compactEvents(kind, events) {
  if (kind === 'bat') return events.map((e) => [e.ball, e.batter, e.runs, e.wicket ? 1 : 0])
  if (kind === 'bowl') return events.map((e) => [e.ball, e.batter, e.bowler, e.runs, e.wicket ? 1 : 0])
  return []
}

// rebuild the same shape the scorecard components get from a live simulation
export function expandMatch(m) {
  if (m.kind === 'bat') {
    let score = 0, wickets = 0
    const events = m.ev.map(([ball, batter, runs, w]) => { score += runs; wickets += w; return { ball, batter, runs, wicket: !!w, score, wickets } })
    const card = m.picks.map((p) => ({ name: p.n, runs: 0, balls: 0, out: false, fours: 0, sixes: 0 }))
    const idx = new Map(card.map((c, i) => [c.name, i]))
    for (const e of events) {
      const c = card[idx.get(e.batter)]
      if (!c) continue
      c.balls += 1; c.runs += e.runs
      if (e.runs === 4) c.fours += 1
      if (e.runs === 6) c.sixes += 1
      if (e.wicket) c.out = true
    }
    return { events, card, score, wickets, ballsUsed: events.length ? events[events.length - 1].ball : 0, target: m.target, won: m.won }
  }
  if (m.kind === 'bowl') {
    let score = 0, wickets = 0
    const events = m.ev.map(([ball, batter, bowler, runs, w]) => { score += runs; wickets += w; return { ball, batter, bowler, runs, wicket: !!w, score, wickets } })
    const figs = m.picks.map((p) => ({ name: p.n, balls: 0, runs: 0, wkts: 0 }))
    const idx = new Map(figs.map((f, i) => [f.name, i]))
    for (const e of events) { const f = figs[idx.get(e.bowler)]; if (f) { f.balls += 1; f.runs += e.runs; f.wkts += e.wicket ? 1 : 0 } }
    return { events, figs, score, wickets, ballsUsed: events.length ? events[events.length - 1].ball : 0, target: m.target, won: m.won, allOut: wickets >= 10, opp: m.opp ? { name: m.opp.n, year: m.opp.y } : { name: '', year: '' } }
  }
  return null
}
