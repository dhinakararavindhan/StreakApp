import { BALLS, SQUADS, BOWL_SCHEDULE, bowlTarget } from './data.js'
import { hashStr } from './rng.js'
import { batAdjust, bowlAdjust, phaseBonus, CAPTAIN } from './rules.js'

// Team-level summary used for ratings display.
const FORM = 0.18
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
  const p = Math.min(120, pow * morale)
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
export function simulate(xi, rand, target = 300, opts = {}) {
  const { cap = -1, cond = null } = opts
  // effective ratings: pitch condition + captain bonus
  const eff = xi.map((p, i) => {
    const a = batAdjust(cond, p)
    let bat = p.bat + a.bat, pow = p.pow * a.pow
    if (i === cap) { bat += CAPTAIN.batBat; pow *= CAPTAIN.batPow }
    return { bat: Math.min(100, bat), pow }
  })
  const { pow: tp, bwl, hasKeeper } = teamRatings(xi)
  // innings 'form': most days average, occasionally the whole side clicks (or doesn't)
  const form = 1 + (rand() + rand() - 1) * FORM
  const morale = (1 + (bwl - 70) / 500 - (hasKeeper ? 0 : 0.04)) * form
  const events = []
  const card = xi.map((p) => ({ name: p.name, runs: 0, balls: 0, out: false, fours: 0, sixes: 0 }))
  let striker = 0, nonStriker = 1, next = 2, wickets = 0, score = 0

  for (let ball = 0; ball < BALLS && wickets < 10; ball++) {
    const need = target - score
    const ballsLeft = BALLS - ball
    const pressure = Math.max(0, Math.min(2, need / ballsLeft - 2.2))
    const b = xi[striker]
    const o = ballOutcome(rand, eff[striker].bat, eff[striker].pow, morale, pressure)
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
    target,
    tp,
  }
}

export function verdict(res, target = res.target) {
  if (res.won) {
    const o = res.ballsUsed
    return o < 105 ? 'IMMORTAL — the impossible, done early.' : `LEGENDARY — ${target} chased down!`
  }
  const d = target - res.score
  if (d <= 5) return `Heartbreak — ${d} short!`
  if (d <= 30) return 'So close. A real shot at history.'
  if (d <= 70) return `Respectable, but ${target} is still a mountain.`
  if (d <= 110) return `A strong T20 total, but ${target} was too many.`
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

export function simulateBowl(attack, opp, rand, target = bowlTarget(1), opts = {}) {
  const { cap = -1, cond = null } = opts
  // effective bowling rating per slot: phase fit + pitch condition + captain
  const effBwl = attack.map((p, i) => Math.min(110, Math.max(0, p.bwl + phaseBonus(i, p) + bowlAdjust(cond, p) + (i === cap ? CAPTAIN.bowl : 0))))
  const oppEff = opp.map((p) => { const a = batAdjust(cond, p); return { bat: Math.min(100, p.bat + a.bat), pow: p.pow * a.pow } })
  const events = []
  const figs = attack.map((p) => ({ name: p.name, balls: 0, runs: 0, wkts: 0 }))
  let striker = 0, nonStriker = 1, next = 2, wickets = 0, score = 0, ball = 0
  outer: for (let over = 0; over < 20; over++) {
    const bi = BOWL_SCHEDULE[over]
    const grit = Math.min(1.15, Math.max(0, (effBwl[bi] - 50) / 50))
    for (let b = 0; b < 6; b++) {
      const bat = opp[striker]
      const o = ballOutcome(rand, oppEff[striker].bat, oppEff[striker].pow, 1, 0, grit)
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
  return { events, figs, score, wickets, ballsUsed: ball, allOut: wickets >= 10, won: score < target, target, opp }
}

export function bowlVerdict(res, target = res.target) {
  if (res.won) return res.score < target * 0.7 ? 'UNTOUCHABLE — a historic bowling display!' : 'LEGENDARY — held them under the line!'
  const d = res.score - target
  if (d <= 5) return `So close — ${d + 1} runs too many.`
  if (d <= 30) return 'Tight, but they got away from you.'
  if (d <= 70) return 'A good effort. Not enough to bowl them out cheap.'
  return 'Smashed all over the park.'
}


// ---------------- Super Over ----------------
// Each side: 3 batters, 1 bowler, 6 balls, 2 wickets ends the innings.
function superInnings(bats, bowler, rand, cond, capIdx = -1) {
  const a = bowler ? Math.min(110, Math.max(0, bowler.bwl + bowlAdjust(cond, bowler))) : 50
  const grit = Math.min(1.15, Math.max(0, (a - 50) / 50))
  let striker = 0, nonStriker = 1, next = 2, wickets = 0, runs = 0
  const events = []
  for (let ball = 1; ball <= 6 && wickets < 2; ball++) {
    const b = bats[striker]
    const adj = batAdjust(cond, b)
    let bat = b.bat + adj.bat, pow = b.pow * adj.pow
    if (striker === capIdx) { bat += CAPTAIN.batBat; pow *= CAPTAIN.batPow }
    const o = ballOutcome(rand, Math.min(100, bat) * 0.8, pow * 1.32, 1, 0, grit * 0.55)
    let r = 0, w = false
    if (o === 'W') { w = true; wickets++; striker = next < 3 ? next++ : -1 } else { r = o; runs += r; if (r % 2 === 1) [striker, nonStriker] = [nonStriker, striker] }
    events.push({ ball, batter: b.name, bowler: bowler ? bowler.name : '', runs: r, wicket: w, score: runs, wickets })
    if (striker < 0) break
  }
  return { runs, wickets, events }
}

// The daily Super Over opponent: the squad's three best hitters and best bowler.
export function superOpponent(seedStr) {
  const sq = SQUADS[hashStr('so' + seedStr) % SQUADS.length]
  const bats = [...sq.players].sort((a, b) => b.pow + b.bat - (a.pow + a.bat)).slice(0, 3)
  const bowler = [...sq.players].sort((a, b) => b.bwl - a.bwl)[0]
  return { id: sq.id, name: sq.name, year: sq.year, bats, bowler }
}

// picks = [bat1, bat2, bat3, bowler]
export function simulateSuper(picks, opp, rand, opts = {}) {
  const { cap = -1, cond = null } = opts
  const mine = superInnings(picks.slice(0, 3), opp.bowler, rand, cond, cap)
  const theirs = superInnings(opp.bats, picks[3], rand, cond, -1)
  return {
    mine, theirs, score: mine.runs, wickets: mine.wickets, oppScore: theirs.runs, ballsUsed: mine.events.length + theirs.events.length,
    won: mine.runs > theirs.runs, tie: mine.runs === theirs.runs, opp,
  }
}
