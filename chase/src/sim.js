import { BALLS } from './data.js'

// Team-level summary used for ratings display.
export function teamRatings(xi) {
  const players = xi.filter(Boolean)
  const top7 = xi.slice(0, 7).filter(Boolean)
  const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)
  const bat = avg(top7.map((p) => p.bat))
  const pow = avg(players.map((p) => p.pow).sort((a, b) => b - a).slice(0, 7))
  const bwl = avg(players.map((p) => p.bwl).sort((a, b) => b - a).slice(0, 4))
  const hasKeeper = players.some((p) => p.k)
  return { bat, pow, bwl, hasKeeper }
}

function ballOutcome(r, bat, pow, morale, pressure) {
  const p = Math.min(100, pow * morale)
  const surviveBalls = 8 + Math.pow(bat / 100, 2) * 80
  const pW = Math.min(0.2, (1 / surviveBalls) * (1 + pressure * 0.35 * (p / 100)))
  const x = r()
  if (x < pW) return 'W'
  const q = p / 100
  const mean = 0.40 + p * 0.0112
  const p6 = 0.01 + 0.09 * q * q
  const p4 = 0.05 + 0.1 * q
  const rest = 1 - p4 - p6
  const mu = Math.max(0.1, Math.min(1.5, (mean - 4 * p4 - 6 * p6) / rest))
  const y = r()
  if (y < p6) return 6
  if (y < p6 + p4) return 4
  const z = (y - p6 - p4) / rest
  const p2 = 0.05, p1 = Math.max(0, mu - 0.1)
  return z < p2 ? 2 : z < p2 + p1 ? 1 : 0
}

// Simulates a whole chase. Returns events + summary. `rand` is a seeded rng.
export function simulate(xi, rand, target = 500) {
  const { pow: tp, bwl, hasKeeper } = teamRatings(xi)
  const morale = 1 + (bwl - 70) / 500 - (hasKeeper ? 0 : 0.04)
  const events = []
  const card = xi.map((p) => ({ name: p.name, runs: 0, balls: 0, out: false, fours: 0, sixes: 0 }))
  let striker = 0, nonStriker = 1, next = 2, wickets = 0, score = 0

  for (let ball = 0; ball < BALLS && wickets < 10; ball++) {
    const need = target - score
    const ballsLeft = BALLS - ball
    const pressure = Math.max(0, Math.min(2, need / ballsLeft - 1.5))
    const b = xi[striker]
    const o = ballOutcome(rand, b.bat, b.pow, morale, pressure)
    card[striker].balls++
    let runs = 0, wicket = false
    if (o === 'W') {
      wicket = true
      card[striker].out = true
      wickets++
      if (next < 11) striker = next++
      else striker = -1
    } else {
      runs = o
      score += runs
      card[striker].runs += runs
      if (runs === 4) card[striker].fours++
      if (runs === 6) card[striker].sixes++
      if (runs % 2 === 1) [striker, nonStriker] = [nonStriker, striker]
    }
    if ((ball + 1) % 6 === 0 && striker >= 0) [striker, nonStriker] = [nonStriker, striker]
    events.push({ ball: ball + 1, batter: b.name, runs, wicket, score, wickets })
    if (score >= target) break
    if (striker < 0) break
  }
  const last = events[events.length - 1]
  return {
    events, card, score, wickets,
    ballsUsed: last ? last.ball : 0,
    won: score >= target,
    tp,
  }
}

export function verdict(res, target = 500) {
  if (res.won) {
    const o = res.ballsUsed
    return o < 270 ? 'IMMORTAL — the impossible, done early.' : 'LEGENDARY — 500 chased down!'
  }
  const d = target - res.score
  if (d <= 10) return `Heartbreak — ${d} short!`
  if (d <= 50) return 'So close. A real shot at history.'
  if (d <= 120) return 'Respectable, but 500 is still a mountain.'
  if (d <= 200) return 'A decent ODI total. Nowhere near 500.'
  return 'Collapse. Back to the drawing board.'
}
