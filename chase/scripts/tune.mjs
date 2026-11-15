import { SQUADS, batTarget } from '../src/data.js'
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
for (const skill of [1, 3, 6]) {
  const sc = []
  for (let i = 0; i < 4000; i++) sc.push(simulate(randomXI(skill), r, 9999).score) // uncapped: how many could they make?
  sc.sort((a, b) => a - b)
  const wins = (target) => (sc.filter((x) => x >= target).length / sc.length * 100).toFixed(1)
  console.log(`skill ${skill}: med ${sc[Math.floor(sc.length / 2)]} | win% by level:`, Array.from({ length: 10 }, (_, i) => `L${i + 1}(${batTarget(i + 1)}) ${wins(batTarget(i + 1))}`).join('  '))
}
