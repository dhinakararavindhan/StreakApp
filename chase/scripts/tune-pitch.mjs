// average batting score and average runs conceded (typical XI / typical attack) on every pitch type
import { PLAYABLE, BOWL_MIN, OPEN_TARGET } from '../src/data.js'
import { CONDITIONS } from '../src/rules.js'
import { simulate, simulateBowl, opponentFor } from '../src/sim.js'
import { rng } from '../src/rng.js'
const r = rng(7)
const fits = (p, s) => s + 1 >= p.lo && s + 1 <= p.hi
const xiOf = () => { const used = new Set(); return Array.from({ length: 11 }, (_, s) => { for (let k = 0; k < 400; k++) { const sq = PLAYABLE[Math.floor(r() * PLAYABLE.length)]; const c = sq.players.filter((p) => fits(p, s) && !used.has(p.name)); if (c.length) { const p = c[Math.floor(r() * c.length)]; used.add(p.name); return p } } }) }
const bowl = PLAYABLE.flatMap((s) => s.players).filter((p) => p.bwl >= BOWL_MIN)
const atk = () => { const u = new Set(); const a = []; while (a.length < 5) { const p = bowl[Math.floor(r() * bowl.length)]; if (!u.has(p.name)) { u.add(p.name); a.push(p) } } return a }
const xis = Array.from({ length: 300 }, xiOf), atks = Array.from({ length: 300 }, atk), N = 6000
const base = {}
for (const c of [null, ...CONDITIONS]) {
  let b = 0, w = 0
  for (let i = 0; i < N; i++) { b += simulate(xis[i % 300], r, OPEN_TARGET, { cond: c }).score; w += simulateBowl(atks[i % 300], opponentFor('s' + (i % 50)).players, r, OPEN_TARGET, { cond: c }).score }
  console.log((c ? c.id : 'none').padEnd(8), 'bat avg', (b / N).toFixed(1), ' conceded avg', (w / N).toFixed(1))
}
