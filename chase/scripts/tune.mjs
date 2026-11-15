import { SQUADS } from '../src/data.js'
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
      const sq = SQUADS[Math.floor(r() * SQUADS.length)]
      const c = sq.players.filter((p) => slotFits(p, s) && !used.has(p.name))
      if (!c.length) continue
      const p = c[Math.floor(r() * c.length)]
      if (!best || p.bat + p.pow + p.bwl > best.bat + best.pow + best.bwl) best = p
    }
    if (!best) { best = SQUADS.flatMap((q) => q.players).find((p) => slotFits(p, s) && !used.has(p.name)) }
    used.add(best.name); xi[s] = best
  }
  return xi
}
for (const skill of [1, 2, 3, 6]) {
  const sc = []
  for (let i = 0; i < 3000; i++) sc.push(simulate(randomXI(skill), r).score)
  sc.sort((a, b) => a - b)
  const q = (p) => sc[Math.floor(p * (sc.length - 1))]
  console.log(`skill ${skill}: p10 ${q(.1)} med ${q(.5)} p90 ${q(.9)} max ${q(1)} wins ${(sc.filter((x) => x >= 500).length / sc.length * 100).toFixed(2)}%`)
}
