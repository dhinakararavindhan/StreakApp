import { SQUADS, BOWL_MIN, BOWL_TARGET } from '../src/data.js'
import { simulateBowl, opponentFor } from '../src/sim.js'
import { rng } from '../src/rng.js'
const r = rng(7)
const pool = SQUADS.flatMap((s) => s.players).filter((p) => p.bwl >= BOWL_MIN)
function attack(skill) {
  const a = [], used = new Set()
  while (a.length < 5) {
    let best = null
    for (let k = 0; k < skill; k++) { const p = pool[Math.floor(r() * pool.length)]; if (used.has(p.name)) continue; if (!best || p.bwl > best.bwl) best = p }
    if (best) { used.add(best.name); a.push(best) }
  }
  return a
}
for (const skill of [1, 2, 4, 8]) {
  const sc = []
  for (let i = 0; i < 4000; i++) sc.push(simulateBowl(attack(skill), opponentFor('x' + i).players, r).score)
  sc.sort((a, b) => a - b)
  const q = (p) => sc[Math.floor(p * (sc.length - 1))]
  console.log(`skill ${skill}: min ${q(0)} p10 ${q(.1)} med ${q(.5)} p90 ${q(.9)} wins(<${BOWL_TARGET}) ${(sc.filter((x) => x < BOWL_TARGET).length / sc.length * 100).toFixed(2)}%`)
}
