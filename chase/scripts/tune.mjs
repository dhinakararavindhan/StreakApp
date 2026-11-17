import { PLAYABLE, batTarget, BAT_LEVELS } from '../src/data.js'
import { CONDITIONS } from '../src/rules.js'
import { simulate } from '../src/sim.js'
import { rng } from '../src/rng.js'

const r = rng(1)
const slotFits = (p, s) => s + 1 >= p.lo && s + 1 <= p.hi
function randomXI(skill) {
  // greedy: for each slot choose best-of-k random candidates that fit
  const xi = Array(11).fill(null), used = new Set()
  const order = [...Array(11).keys()].sort(() => r() - 0.5)
  for (const s of order) {
    let best = null
    for (let k = 0; k < skill; k++) {
      const sq = PLAYABLE[Math.floor(r() * PLAYABLE.length)]
      const c = sq.players.filter((p) => slotFits(p, s) && !used.has(p.name))
      if (!c.length) continue
      const p = c[Math.floor(r() * c.length)]
      if (!best || p.bat + p.pow + p.bwl > best.bat + best.pow + best.bwl) best = p
    }
    if (!best) { best = PLAYABLE.flatMap((q) => q.players).find((p) => slotFits(p, s) && !used.has(p.name)) }
    used.add(best.name); xi[s] = best
  }
  return xi
}
const N = Number(process.env.N || 20000)
for (const skill of [1, 3, 6]) {
  const xis = Array.from({ length: 2500 }, () => randomXI(skill))
  const row = []
  for (let l = 1; l <= BAT_LEVELS; l++) {
    let w = 0, n = 0
    for (let k = 0; k < N / 10; k++) { const xi = xis[k % xis.length]; const cap = xi.reduce((b, p, i) => (p.bat + p.pow > xi[b].bat + xi[b].pow ? i : b), 0); if (simulate(xi, r, batTarget(l), { cap, cond: CONDITIONS[Math.floor(r() * CONDITIONS.length)] }).won) w++; n++ }
    row.push(`L${l}(${batTarget(l)}) ${(w / n * 100).toFixed(2)}`)
  }
  console.log(`skill ${skill}:`, row.join('  '))
}
