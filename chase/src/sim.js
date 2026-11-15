import { BALLS, SQUADS, BOWL_SCHEDULE, BOWL_TARGET } from './data.js'
import { hashStr } from './rng.js'

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

function ballOutcome(r, bat, pow, morale, pressure, grit = 0) {
  const p = Math.min(100, pow * morale)
  const surviveBalls = (5 + Math.pow(bat / 100, 2) * 40) * (1 - 0.4 * grit)
  const pW = Math.min(0.2, (1 / surviveBalls) * (1 + pressure * 0.35 * (p / 100)))
  const x = r()
  if (x < pW) return 'W'
  const q = p / 100
  const sc = 1 - 0.4 * grit // good bowling squeezes scoring
  const mean = (0.58 + p * 0.0158) * sc
  const p6 = (0.02 + 0.16 * q * q) * sc
  const p4 = (0.08 + 0.1 * q) * sc
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
export function simulate(xi, rand, target = 300) {
  const { pow: tp, bwl, hasKeeper } = teamRatings(xi)
  const morale = 1 + (bwl - 70) / 500 - (hasKeeper ? 0 : 0.04)
  const events = []
  const card = xi.map((p) => ({ name: p.name, runs: 0, balls: 0, out: false, fours: 0, sixes: 0 }))
  let striker = 0, nonStriker = 1, next = 2, wickets = 0, score = 0

  for (let ball = 0; ball < BALLS && wickets < 10; ball++) {
    const need = target - score
    const ballsLeft = BALLS - ball
    const pressure = Math.max(0, Math.min(2, need / ballsLeft - 2.2))
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

export function verdict(res, target = 300) {
  if (res.won) {
    const o = res.ballsUsed
    return o < 105 ? 'IMMORTAL — the impossible, done early.' : 'LEGENDARY — 300 chased down!'
  }
  const d = target - res.score
  if (d <= 5) return `Heartbreak — ${d} short!`
  if (d <= 30) return 'So close. A real shot at history.'
  if (d <= 70) return 'Respectable, but 300 is still a mountain.'
  if (d <= 110) return 'A strong T20 total. Nowhere near 300.'
  return 'Collapse. Back to the drawing board.'
}


// ---------------- Bowling challenge ----------------
// The daily opponent: a squad's XI, in batting order.
export function opponentFor(seedStr) {
  const sq = SQUADS[hashStr('opp' + seedStr) % SQUADS.length]
  return { id: sq.id, name: sq.name, year: sq.year, players: [...sq.players].sort((a, b) => a.lo - b.lo || b.bat - a.bat) }
}

export function bowlRatings(attack) {
  const a = attack.filter(Boolean)
  const avg = (k) => (a.length ? a.reduce((s, p) => s + p[k], 0) / a.length : 0)
  return { bwl: avg('bwl'), n: a.length }
}

export function simulateBowl(attack, opp, rand, target = BOWL_TARGET) {
  const events = []
  const figs = attack.map((p) => ({ name: p.name, balls: 0, runs: 0, wkts: 0 }))
  let striker = 0, nonStriker = 1, next = 2, wickets = 0, score = 0, ball = 0
  outer: for (let over = 0; over < 20; over++) {
    const bi = BOWL_SCHEDULE[over]
    const grit = Math.max(0, (attack[bi].bwl - 50) / 50)
    for (let b = 0; b < 6; b++) {
      const bat = opp[striker]
      const o = ballOutcome(rand, bat.bat, bat.pow, 1, 0, grit)
      ball++
      figs[bi].balls++
      let runs = 0, wicket = false
      if (o === 'W') {
        wicket = true; wickets++; figs[bi].wkts++
        if (next < 11) striker = next++; else striker = -1
      } else {
        runs = o; score += runs; figs[bi].runs += runs
        if (runs % 2 === 1) [striker, nonStriker] = [nonStriker, striker]
      }
      events.push({ ball, bowler: attack[bi].name, batter: bat.name, runs, wicket, score, wickets })
      if (striker < 0) break outer
    }
    if (striker >= 0) [striker, nonStriker] = [nonStriker, striker]
  }
  return { events, figs, score, wickets, ballsUsed: ball, allOut: wickets >= 10, won: score < target, opp }
}

export function bowlVerdict(res, target = BOWL_TARGET) {
  if (res.won) return res.score < target * 0.7 ? 'UNTOUCHABLE — a historic bowling display!' : 'LEGENDARY — held them under the line!'
  const d = res.score - target
  if (d <= 5) return `So close — ${d + 1} runs too many.`
  if (d <= 30) return 'Tight, but they got away from you.'
  if (d <= 70) return 'A good effort. Not enough to bowl them out cheap.'
  return 'Smashed all over the park.'
}
